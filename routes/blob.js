const express = require('express');
const Busboy = require('busboy');
const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const router = express.Router();

// Using Busboy for true streaming uploads (no memory buffering)

// Initialize blob client using managed identity
let blobServiceClient;
let containerClient;

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
const buildHierarchy = (blobs, folderPath = '') => {
  const folders = new Map();
  const files = [];

  for (const blob of blobs) {
    const normalized = normalizePath(blob.name);
    
    // Skip blobs not in current folder
    if (folderPath) {
      if (!normalized.startsWith(folderPath + '/')) continue;
    } else {
      if (normalized.includes('/')) continue;
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

// GET /api/files/exists/:name - Check if blob exists (Reader+)
// MUST be before /:name route to avoid wildcard matching
router.get('/exists/:name', async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'reader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const blobClient = containerClient.getBlobClient(req.params.name);
    const exists = await blobClient.exists();
    res.json({ exists });
  } catch (error) {
    console.error('Error checking blob existence:', error.message);
    res.status(500).json({ error: 'Failed to check file existence' });
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

// GET /api/files/:name - Download file (Reader+)
router.get('/:name', async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'reader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const blobClient = containerClient.getBlobClient(req.params.name);
    const download = await blobClient.download();

    res.setHeader('Content-Type', download.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
    download.readableStreamBody.pipe(res);
  } catch (error) {
    console.error('Error downloading blob:', error.message);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// POST /api/files - Upload file (Uploader+)
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

// DELETE /api/files/:name - Delete file (Uploader+)
router.delete('/:name', async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const blobClient = containerClient.getBlobClient(req.params.name);
    await blobClient.delete();

    res.json({ message: 'File deleted successfully', filename: req.params.name });
  } catch (error) {
    console.error('Error deleting blob:', error.message);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// POST /api/files/folders/create - Create folder (Uploader+)
// Note: We don't actually create a blob - folders are virtual based on file paths
// The folder will appear once files are uploaded into it
router.post('/folders/create', async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'folderPath is required' });
    }

    const normalized = normalizePath(folderPath);
    console.log(`Creating folder: ${normalized}`);

    // In Azure Blob Storage, folders are virtual - they exist when files exist in them
    // We just return success since the folder will be created automatically when
    // users upload files into it via the ?folder= parameter
    res.json({ 
      message: 'Folder created successfully', 
      folderPath: normalized,
      note: 'Folders are virtual and will appear once files are uploaded into them',
    });
  } catch (error) {
    console.error('Error creating folder:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to create folder', details: error.message });
  }
});

// POST /api/files/move - Move file to different folder (Uploader+)
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

    // Download source blob
    const sourceClient = containerClient.getBlobClient(sourceNorm);
    const downloadResponse = await sourceClient.download();
    const buffer = await streamToBuffer(downloadResponse.blobBody);

    // Upload to destination
    const destClient = containerClient.getBlockBlobClient(destNorm);
    await destClient.upload(buffer, buffer.length);

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

    // Download the blob
    const sourceClient = containerClient.getBlobClient(oldNorm);
    console.log(`Getting source client for: ${oldNorm}`);
    
    const downloadResponse = await sourceClient.download();
    console.log(`Downloaded blob, converting stream to buffer`);
    
    const buffer = await streamToBuffer(downloadResponse.blobBody);
    console.log(`Buffer created, size: ${buffer.length} bytes`);

    // Upload to new path
    const destClient = containerClient.getBlockBlobClient(newPath);
    console.log(`Uploading to destination: ${newPath}`);
    
    await destClient.upload(buffer, buffer.length);
    console.log(`Successfully uploaded to ${newPath}`);

    // Delete original
    console.log(`Deleting original blob: ${oldNorm}`);
    await sourceClient.delete();
    console.log(`Successfully deleted ${oldNorm}`);

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

// DELETE /api/files/folders/:folderPath - Delete folder and contents (Uploader+)
router.delete('/folders/:folderPath', async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const folderPath = normalizePath(req.params.folderPath);
    console.log(`Deleting folder and contents: ${folderPath}`);
    
    let deletedCount = 0;

    // List all blobs in folder and delete them
    for await (const blob of containerClient.listBlobsFlat()) {
      if (blob.name.startsWith(folderPath + '/')) {
        console.log(`Deleting blob: ${blob.name}`);
        await containerClient.getBlobClient(blob.name).delete();
        deletedCount++;
      }
    }

    console.log(`Deleted ${deletedCount} items from folder: ${folderPath}`);

    res.json({ 
      message: 'Folder deleted successfully',
      folderPath,
      itemsDeleted: deletedCount,
    });
  } catch (error) {
    console.error('Error deleting folder:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to delete folder', details: error.message });
  }
});

module.exports = router;
