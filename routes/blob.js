const express = require('express');
const Busboy = require('busboy');
const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const router = express.Router();

// Using Busboy for true streaming uploads (no memory buffering)

// Initialize blob client using managed identity
const blobServiceClient = new BlobServiceClient(
  `https://${process.env.STORAGE_ACCOUNT}.blob.core.windows.net`,
  new DefaultAzureCredential()
);

const containerClient = blobServiceClient.getContainerClient(process.env.STORAGE_CONTAINER);

// Helper: check permission
const checkPermission = (roles, requiredRole) => {
  if (requiredRole === 'admin') return roles.isAdmin;
  if (requiredRole === 'uploader') return roles.isAdmin || roles.isUploader;
  if (requiredRole === 'reader') return roles.isAdmin || roles.isUploader || roles.isReader;
  return false;
};

// GET /api/files - List files (Reader+)
router.get('/', async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'reader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const files = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      files.push({
        name: blob.name,
        size: blob.properties.contentLength,
        created: blob.properties.createdOn,
      });
    }

    res.json({ files });
  } catch (error) {
    console.error('Error listing blobs:', error.message);
    res.status(500).json({ error: 'Failed to list files' });
  }
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

        console.log(`Starting upload: ${safeFilename} (${contentType})`);

        const blobClient = containerClient.getBlockBlobClient(safeFilename);
        const bufferSize = 4 * 1024 * 1024; // 4MB blocks
        const maxConcurrency = 5; // tune for throughput

        blobClient
          .uploadStream(file, bufferSize, maxConcurrency, {
            blobHTTPHeaders: { blobContentType: contentType },
          })
          .then(() => {
            console.log(`Upload completed: ${safeFilename}`);
          })
          .catch((err) => {
            console.error(`Upload failed: ${safeFilename}`, err.message);
          });

        if (!responded) {
          responded = true;
          res.json({ message: 'File upload started', filename: safeFilename });
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

// GET /api/files/exists/:name - Check if blob exists (Reader+)
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

// POST /api/files/chunked - Upload file chunk (Uploader+)
router.post('/chunked', (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const bb = Busboy({ headers: req.headers, limits: { files: 1 } });
    let responded = false;
    let chunkMetadata = {};

    // Collect form fields (filename, chunkIndex, totalChunks)
    bb.on('field', (fieldname, val) => {
      chunkMetadata[fieldname] = val;
    });

    bb.on('file', async (fieldname, file, info) => {
      try {
        const { filename, chunkIndex, totalChunks } = chunkMetadata;
        
        if (!filename || chunkIndex === undefined || !totalChunks) {
          if (!responded) {
            responded = true;
            res.status(400).json({ error: 'Missing metadata: filename, chunkIndex, totalChunks required' });
          }
          file.resume(); // drain the stream
          return;
        }

        const blockId = Buffer.from(`chunk-${String(chunkIndex).padStart(6, '0')}`).toString('base64');
        const blobClient = containerClient.getBlockBlobClient(filename);

        console.log(`Uploading chunk ${chunkIndex}/${totalChunks} for ${filename}`);

        // Upload this chunk as a block
        const chunks = [];
        for await (const chunk of file) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        await blobClient.stageBlock(blockId, buffer, buffer.length);

        console.log(`Chunk ${chunkIndex}/${totalChunks} uploaded for ${filename}`);

        if (!responded) {
          responded = true;
          res.json({ 
            message: 'Chunk uploaded', 
            chunkIndex: parseInt(chunkIndex),
            blockId 
          });
        }
      } catch (fileErr) {
        console.error('Error uploading chunk:', fileErr.message);
        if (!responded) {
          responded = true;
          res.status(500).json({ error: 'Failed to upload chunk' });
        }
      }
    });

    bb.on('error', (err) => {
      console.error('Busboy error in chunked upload:', err.message);
      if (!responded) {
        responded = true;
        res.status(500).json({ error: 'Failed to process chunk' });
      }
    });

    req.pipe(bb);
  } catch (error) {
    console.error('Error in chunked upload:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to upload chunk' });
    }
  }
});

// POST /api/files/chunked/commit - Finalize chunked upload (Uploader+)
router.post('/chunked/commit', async (req, res) => {
  try {
    if (!checkPermission(req.user.roles, 'uploader')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { filename, totalChunks, contentType } = req.body;

    if (!filename || !totalChunks) {
      return res.status(400).json({ error: 'Missing filename or totalChunks' });
    }

    const blobClient = containerClient.getBlockBlobClient(filename);

    // Build list of block IDs in order
    const blockList = [];
    for (let i = 0; i < parseInt(totalChunks); i++) {
      const blockId = Buffer.from(`chunk-${String(i).padStart(6, '0')}`).toString('base64');
      blockList.push(blockId);
    }

    console.log(`Committing ${totalChunks} chunks for ${filename}`);

    // Commit all blocks to create the final blob
    await blobClient.commitBlockList(blockList, {
      blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' }
    });

    console.log(`Chunked upload completed: ${filename}`);

    res.json({ message: 'File uploaded successfully', filename });
  } catch (error) {
    console.error('Error committing chunks:', error.message);
    res.status(500).json({ error: 'Failed to finalize upload' });
  }
});

module.exports = router;
