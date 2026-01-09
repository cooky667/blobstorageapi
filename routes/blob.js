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

module.exports = router;
