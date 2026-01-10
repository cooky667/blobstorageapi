const express = require('express');
const Busboy = require('busboy');
const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const crypto = require('crypto');

const router = express.Router();

// Using Busboy for true streaming uploads (no memory buffering)

// Initialize blob client using managed identity
let blobServiceClient;
let containerClient;

// Download token config
const DOWNLOAD_TOKEN_SECRET = process.env.DOWNLOAD_TOKEN_SECRET || 'download-token-secret';
const DOWNLOAD_TOKEN_TTL_SECONDS = 5 * 60; // 5 minutes

try {
  console.log('Initializing Azure Storage client...');
  console.log('Storage Account:', process.env.STORAGE_ACCOUNT);
  console.log('Storage Container:', process.env.STORAGE_CONTAINER);
  
  if (!process.env.STORAGE_ACCOUNT || !process.env.STORAGE_CONTAINER) {
    throw new Error('Missing STORAGE_ACCOUNT or STORAGE_CONTAINER environment variables');
  }
  
  blobServiceClient = new BlobServiceClient(
    `https://${process.env.STORAGE_ACCOUNT}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );

  containerClient = blobServiceClient.getContainerClient(process.env.STORAGE_CONTAINER);
  console.log('Azure Storage client initialized successfully');
} catch (error) {
  console.error('FATAL: Failed to initialize Azure Storage client:', error);
  console.error('Stack:', error.stack);
  throw error; // This will prevent the app from starting if storage init fails
}

// Helper: check permission
const checkPermission = (roles, requiredRole) => {
  if (requiredRole === 'admin') return roles.isAdmin;
  if (requiredRole === 'uploader') return roles.isAdmin || roles.isUploader;
  if (requiredRole === 'reader') return roles.isAdmin || roles.isUploader || roles.isReader;
  return false;
};

// Simple HMAC-based download token (path + expiry)
const createDownloadToken = (path) => {
  const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TOKEN_TTL_SECONDS;
  const payload = `${path}|${exp}`;
  const sig = crypto.createHmac('sha256', DOWNLOAD_TOKEN_SECRET).update(payload).digest('hex');
  const token = Buffer.from(`${payload}|${sig}`).toString('base64url');
  return token;
};

const verifyDownloadToken = (token) => {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [path, expStr, sig] = decoded.split('|');
    if (!path || !expStr || !sig) return null;
    const payload = `${path}|${expStr}`;
    const expected = crypto.createHmac('sha256', DOWNLOAD_TOKEN_SECRET).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const exp = parseInt(expStr, 10);
    if (Number.isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    return { path };
  } catch (e) {
    return null;
  }
};

// Helper: normalize path (remove leading/trailing slashes)
const normalizePath = (path) => {
  return path.replace(/^\/+|\/+$/g, '');
};

// Helper: get folder path from file path
const getFolderPath = (path) => {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '' : normalized.substring(0, lastSlash);
};

// Helper: get file/folder name from path
const getBaseName = (path) => {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.substring(lastSlash + 1);
};

// Helper: convert readable stream to buffer
const streamToBuffer = (readableStream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data));
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    readableStream.on('error', reject);
  });
};

// Helper: build hierarchical structure from flat blob list
// Filters out .keep marker blobs (folder markers) from file lists
const buildHierarchy = (blobs, folderPath = '') => {
  const folders = new Map();
  const files = [];

  for (const blob of blobs) {
    const normalized = normalizePath(blob.name);
    
    // Skip .keep marker blobs (used to persist empty folders)
    if (normalized.endsWith('/.keep') || normalized === '.keep') continue;
    
    // Skip blobs not in current folder
    if (folderPath) {
      if (!normalized.startsWith(folderPath + '/')) continue;
    }

    // Get relative path from current folder
    const relativePath = folderPath 
      ? normalized.substring(folderPath.length + 1) 
      : normalized;

    if (relativePath.includes('/')) {
      // This is a file in a subfolder - extract folder name
      const subfolderName = relativePath.substring(0, relativePath.indexOf('/'));
      if (!folders.has(subfolderName)) {
        folders.set(subfolderName, {
          name: subfolderName,
          path: folderPath ? folderPath + '/' + subfolderName : subfolderName,
          type: 'folder',
          children: 0,
        });
      }
      folders.get(subfolderName).children++;
    } else {
      // This is a file in current folder
      files.push({
        name: relativePath,
        fullPath: normalized,
        size: blob.properties.contentLength,
        created: blob.properties.createdOn,
        type: 'file',
      });
    }
  }

  return {
    folders: Array.from(folders.values()),
    files,
  };
};

// GET /api/files - List files with hierarchical structure (Reader+)
router.get('/', async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'reader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const folderPath = req.query.folder ? normalizePath(req.query.folder) : '';
    const blobs = [];
    
    for await (const blob of containerClient.listBlobsFlat()) {
      blobs.push(blob);
    }

    const structure = buildHierarchy(blobs, folderPath);
    res.json({ 
      currentPath: folderPath || '/',
      ...structure,
    });
  } catch (error) {
    console.error('Error listing blobs:', error.message);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// GET /api/files/exists/* - Check if blob exists (Reader+)
// Use regex to safely capture full blob path (including slashes)
// MUST be before catch-all download route to avoid wildcard matching
router.get(/^\/exists\/(.+)$/i, async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'reader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const blobPath = normalizePath(req.params[0] || '');
    const blobClient = containerClient.getBlobClient(blobPath);
    const exists = await blobClient.exists();
    res.json({ exists });
  } catch (error) {
    console.error('Error checking blob existence:', error.message);
    res.status(500).json({ error: 'Failed to check file existence' });
  }
});

// POST /api/files/download-token - Issue short-lived download token (Reader+)
router.post('/download-token', express.json(), async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'reader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { path } = req.body || {};
    if (!path) return res.status(400).json({ error: 'Missing path' });
    const normalized = normalizePath(path);
    const token = createDownloadToken(normalized);
    res.json({ token });
  } catch (error) {
    console.error('Error creating download token:', error.message);
    res.status(500).json({ error: 'Failed to create download token' });
  }
});

// POST /api/files/chunked/commit - Finalize chunked upload (Uploader+)
// MUST be before /chunked route to match more specific path first
router.post('/chunked/commit', express.json(), async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { filename, totalChunks, contentType, folder } = req.body;
    const targetFolder = folder ? normalizePath(folder) : '';

    if (!filename || !totalChunks) {
      return res.status(400).json({ error: 'Missing filename or totalChunks' });
    }

    // Build full blob path with folder
    const fullPath = targetFolder ? targetFolder + '/' + filename : filename;
    const blobClient = containerClient.getBlockBlobClient(fullPath);

    // Build list of block IDs in order
    const blockList = [];
    for (let i = 0; i < parseInt(totalChunks); i++) {
      const blockId = Buffer.from(`chunk-${String(i).padStart(6, '0')}`).toString('base64');
      blockList.push(blockId);
    }

    console.log(`Committing ${totalChunks} chunks for ${fullPath}`);

    // Commit all blocks to create the final blob
    await blobClient.commitBlockList(blockList, {
      blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' }
    });

    console.log(`Chunked upload completed: ${fullPath}`);
    res.json({ message: 'File uploaded successfully', filename, path: fullPath });
  } catch (error) {
    console.error('Error committing chunks:', error.message);
    res.status(500).json({ error: 'Failed to finalize upload' });
  }
});

// POST /api/files/chunked - Upload file chunk (Uploader+)
// MUST be before /:name route to avoid wildcard matching
router.post('/chunked', (req, res) => {
  if (!checkPermission(req.user.roles, 'uploader')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  // Get metadata from query parameters
  const { filename, chunkIndex, totalChunks, folder } = req.query;
  const targetFolder = folder ? normalizePath(folder) : '';

  if (!filename || chunkIndex === undefined || !totalChunks) {
    return res.status(400).json({ 
      error: 'Missing query parameters',
      received: { filename, chunkIndex, totalChunks }
    });
  }

  // Build full blob path with folder
  const fullPath = targetFolder ? targetFolder + '/' + filename : filename;

  const bb = Busboy({ headers: req.headers });
  let responded = false;

  bb.on('file', (fieldname, file, info) => {
    const blockId = Buffer.from(`chunk-${String(chunkIndex).padStart(6, '0')}`).toString('base64');
    const blobClient = containerClient.getBlockBlobClient(fullPath);

    const buffers = [];
    let totalSize = 0;

    file.on('data', (chunk) => {
      buffers.push(chunk);
      totalSize += chunk.length;
    });

    file.on('end', async () => {
      try {
        const buffer = Buffer.concat(buffers, totalSize);
        await blobClient.stageBlock(blockId, buffer, buffer.length);

        if (!responded) {
          responded = true;
          res.json({ message: 'Chunk uploaded', chunkIndex: parseInt(chunkIndex), blockId });
        }
      } catch (err) {
        if (!responded) {
          responded = true;
          res.status(500).json({ error: 'Failed to stage block', details: err.message });
        }
      }
    });

    file.on('error', (err) => {
      if (!responded) {
        responded = true;
        res.status(500).json({ error: 'File stream error', details: err.message });
      }
    });
  });

  bb.on('error', (err) => {
    if (!responded) {
      responded = true;
      res.status(500).json({ error: 'Busboy error', details: err.message });
    }
  });

  req.pipe(bb);
});

// POST /api/files/folders/create - Create folder (Uploader+)
// MUST be before catch-all POST / to match specific path first
// Creates a .keep marker blob to persist the folder even if empty
router.post('/folders/create', express.json(), async (req, res) => {
  try {
    console.log('=== FOLDER CREATE REQUEST ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('User roles:', req.user?.roles);
    
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { folderPath } = req.body;
    if (!folderPath) {
      console.error('folderPath missing from request body');
      return res.status(400).json({ error: 'folderPath is required' });
    }

    const normalized = normalizePath(folderPath);
    console.log(`Creating folder with .keep marker: ${normalized}/.keep`);

    // Create a .keep marker blob to persist the folder
    const markerPath = normalized + '/.keep';
    const blobClient = containerClient.getBlockBlobClient(markerPath);
    await blobClient.upload(Buffer.alloc(0), 0, {
      blobHTTPHeaders: { blobContentType: 'application/x-msdownload' }
    });

    console.log(`✓ Folder created successfully: ${normalized}`);
    res.json({ 
      message: 'Folder created successfully', 
      folderPath: normalized,
    });
  } catch (error) {
    console.error('Error creating folder:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to create folder', details: error.message });
  }
});

// POST /api/files/move - Move file to different folder (Uploader+)
// MUST be before catch-all POST / to match specific path first
router.post('/move', async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { sourcePath, destinationPath } = req.body;
    if (!sourcePath || !destinationPath) {
      return res.status(400).json({ error: 'sourcePath and destinationPath are required' });
    }

    const sourceNorm = normalizePath(sourcePath);
    const destNorm = normalizePath(destinationPath);

    // Server-side move via copy + delete (fast, no data transfer through API)
    const sourceClient = containerClient.getBlobClient(sourceNorm);
    const destClient = containerClient.getBlobClient(destNorm);
    
    console.log(`Starting server-side copy from ${sourceNorm} to ${destNorm}`);
    const copyPoller = await destClient.beginCopyFromURL(sourceClient.url);
    await copyPoller.pollUntilDone();
    console.log(`Copy completed for move operation`);

    // Delete source
    await sourceClient.delete();

    res.json({ 
      message: 'File moved successfully',
      from: sourceNorm,
      to: destNorm,
    });
  } catch (error) {
    console.error('Error moving file:', error.message);
    res.status(500).json({ error: 'Failed to move file' });
  }
});

// POST /api/files/rename - Rename file or folder (Uploader+)
// MUST be before catch-all POST / to match specific path first
router.post('/rename', async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) {
      return res.status(400).json({ error: 'oldPath and newName are required' });
    }

    const oldNorm = normalizePath(oldPath);
    const folderPath = getFolderPath(oldNorm);
    const newPath = folderPath ? folderPath + '/' + newName : newName;

    console.log(`Renaming file: ${oldNorm} -> ${newPath}`);

    // Use server-side copy (instant, no download/upload needed)
    const sourceClient = containerClient.getBlobClient(oldNorm);
    const destClient = containerClient.getBlobClient(newPath);
    
    console.log(`Starting server-side copy from ${oldNorm} to ${newPath}`);
    const copyPoller = await destClient.beginCopyFromURL(sourceClient.url);
    
    // Wait for copy to complete
    await copyPoller.pollUntilDone();
    console.log(`Copy completed successfully`);

    // Delete original
    console.log(`Deleting original blob: ${oldNorm}`);
    await sourceClient.delete();
    console.log(`Rename completed: ${oldNorm} -> ${newPath}`);

    res.json({ 
      message: 'Renamed successfully',
      oldPath: oldNorm,
      newPath,
    });
  } catch (error) {
    console.error('Error renaming:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to rename', details: error.message });
  }
});

// POST /api/files - Upload file (Uploader+)
// Generic catch-all - MUST be after all specific POST routes
router.post('/', (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get target folder from query params
    const targetFolder = req.query.folder ? normalizePath(req.query.folder) : '';

    const bb = Busboy({ headers: req.headers, limits: { files: 1 } });
    let responded = false;
    let fileReceived = false;

    bb.on('file', (fieldname, file, info) => {
      try {
        fileReceived = true;
        console.log('Busboy file event - fieldname:', fieldname, 'info:', info);
        const safeFilename = info.filename || `upload_${Date.now()}`;
        // Busboy v1.x uses `mimeType` for MIME type, not `encoding`
        const contentType = info.mimeType || 'application/octet-stream';

        // Build full blob path with folder
        const fullPath = targetFolder ? targetFolder + '/' + safeFilename : safeFilename;

        console.log(`Starting upload: ${fullPath} (${contentType})`);

        const blobClient = containerClient.getBlockBlobClient(fullPath);
        const bufferSize = 4 * 1024 * 1024; // 4MB blocks
        const maxConcurrency = 5; // tune for throughput

        blobClient
          .uploadStream(file, bufferSize, maxConcurrency, {
            blobHTTPHeaders: { blobContentType: contentType },
          })
          .then(() => {
            console.log(`Upload completed: ${fullPath}`);
          })
          .catch((err) => {
            console.error(`Upload failed: ${fullPath}`, err.message);
          });

        if (!responded) {
          responded = true;
          res.json({ message: 'File upload started', filename: safeFilename, path: fullPath });
        }
      } catch (fileErr) {
        console.error('Error in file handler:', fileErr.message);
        if (!responded) {
          responded = true;
          res.status(500).json({ error: 'Failed to process file' });
        }
      }
    });

    bb.on('error', (err) => {
      console.error('Busboy error:', err.message);
      if (!responded) {
        responded = true;
        res.status(500).json({ error: 'Failed to upload file' });
      }
    });

    bb.on('finish', () => {
      if (!fileReceived && !responded) {
        responded = true;
        res.status(400).json({ error: 'No file provided' });
      }
    });

    req.pipe(bb);
  } catch (error) {
    console.error('Error uploading blob:', error.message, error.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to upload file' });
    }
  }
});

// GET /api/files/* - Download file (Reader+)
// Use regex to safely capture full blob path (including slashes)
// MUST be last to avoid matching more specific routes
router.get(/^\/(.+)$/i, async (req, res) => {
  try {
    const blobPath = normalizePath(req.params[0] || '');

    // Allow either bearer auth (default) or a short-lived download token
    let authorized = false;
    if (req.user && req.user.roles && checkPermission(req.user.roles, 'reader')) {
      authorized = true;
    } else if (req.query.dt) {
      const verified = verifyDownloadToken(req.query.dt);
      if (verified && verified.path === blobPath) {
        authorized = true;
      }
    }

    if (!authorized) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const blobClient = containerClient.getBlobClient(blobPath);
    const download = await blobClient.download();

    // Set headers early so browser starts download immediately
    const props = await blobClient.getProperties();
    res.setHeader('Content-Type', download.contentType || 'application/octet-stream');
    const filename = blobPath.split('/').pop() || blobPath;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (props?.contentLength) {
      res.setHeader('Content-Length', props.contentLength);
    }
    download.readableStreamBody.pipe(res);
  } catch (error) {
    console.error('Error downloading blob:', error.message);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// DELETE /api/files/* - Delete file (Uploader+)
// Regex route to capture blob paths with slashes (e.g., subfolder/file.txt)
// MUST be last to avoid matching more specific routes
router.delete(/^\/(.+)$/i, async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const blobPath = req.params[0];
    const blobClient = containerClient.getBlobClient(blobPath);
    await blobClient.delete();

    res.json({ message: 'File deleted successfully', filename: blobPath });
  } catch (error) {
    console.error('Error deleting blob:', error.message);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// DELETE /api/files/folders/* - Delete empty folder (Uploader+)
// Requires folder to be empty (no files except .keep marker)
router.delete(/^\/folders\/(.+)$/i, async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const folderPath = normalizePath(req.params[0] || '');
    if (!folderPath) {
      return res.status(400).json({ error: 'folderPath is required' });
    }

    // Check if folder has any non-.keep blobs
    const prefix = folderPath + '/';
    let hasContents = false;
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      if (blob.name !== folderPath + '/.keep') {
        hasContents = true;
        break;
      }
    }

    if (hasContents) {
      return res.status(409).json({ error: 'Folder is not empty. Delete contents first.' });
    }

    // Delete the .keep marker blob
    const markerPath = folderPath + '/.keep';
    const blobClient = containerClient.getBlobClient(markerPath);
    await blobClient.delete();

    res.json({ message: 'Folder deleted successfully', folderPath });
  } catch (error) {
    console.error('Error deleting folder:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to delete folder', details: error.message });
  }
});

module.exports = router;
