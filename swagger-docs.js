/**
 * @swagger
 * /api/files:
 *   get:
 *     summary: List files and folders in current path
 *     description: |
 *       Retrieves a hierarchical listing of all files and folders in the specified path.
 *       
 *       **Features:**
 *       - Returns folders and files in separate arrays
 *       - Automatically filters out internal .keep marker blobs
 *       - Shows item counts for folders
 *       - Includes file sizes and creation timestamps
 *       
 *       **Permissions:** Reader role or above required
 *     operationId: listFiles
 *     tags:
 *       - Files & Folders
 *     parameters:
 *       - in: query
 *         name: folder
 *         schema:
 *           type: string
 *         description: Optional folder path to list (e.g., 'documents/reports'). Omit for root listing.
 *         examples:
 *           root:
 *             value: ""
 *             description: List root folder
 *           nested:
 *             value: "documents/reports"
 *             description: List nested folder
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved file and folder listing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currentPath:
 *                   type: string
 *                   example: "/documents"
 *                 folders:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                         example: "reports"
 *                       path:
 *                         type: string
 *                         example: "documents/reports"
 *                       type:
 *                         type: string
 *                         enum: ["folder"]
 *                       children:
 *                         type: integer
 *                         example: 5
 *                 files:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                         example: "invoice.pdf"
 *                       fullPath:
 *                         type: string
 *                         example: "documents/invoice.pdf"
 *                       size:
 *                         type: integer
 *                         description: File size in bytes
 *                         example: 102400
 *                       created:
 *                         type: string
 *                         format: date-time
 *                         example: "2026-01-11T10:30:00Z"
 *                       type:
 *                         type: string
 *                         enum: ["file"]
 *       403:
 *         description: Insufficient permissions - Reader role or above required
 *       500:
 *         description: Server error listing files
 *
 *   post:
 *     summary: Upload file to storage
 *     description: |
 *       Uploads a file to storage with support for resumable chunked uploads.
 *       
 *       **Features:**
 *       - Streaming upload (no memory buffering)
 *       - Resumable uploads for large files
 *       - Chunked uploads for files >100MB (automatic in UI)
 *       - Real-time progress tracking
 *       - Supports any file type and size
 *       
 *       **Permissions:** Uploader role or above required
 *       
 *       **Upload modes:**
 *       - **Single request:** For files <100MB, upload in one request
 *       - **Chunked:** For large files, upload in 50MB chunks then commit
 *     operationId: uploadFile
 *     tags:
 *       - Upload
 *     parameters:
 *       - in: query
 *         name: uploadId
 *         schema:
 *           type: string
 *         description: Unique upload session ID (for resumable/chunked uploads)
 *       - in: query
 *         name: chunkIndex
 *         schema:
 *           type: integer
 *         description: Chunk index (0-based) when uploading in chunks
 *       - in: query
 *         name: totalChunks
 *         schema:
 *           type: integer
 *         description: Total number of chunks in upload
 *       - in: query
 *         name: folder
 *         schema:
 *           type: string
 *         description: Target folder path (optional)
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: File to upload
 *             required:
 *               - file
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "File uploaded successfully"
 *                 filePath:
 *                   type: string
 *                   example: "documents/newfile.pdf"
 *                 fileSize:
 *                   type: integer
 *                   example: 1024000
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Upload failed
 *
 *   delete:
 *     summary: Delete file from storage
 *     description: |
 *       Permanently deletes a file from storage.
 *       
 *       **Permissions:** Uploader role or above required
 *       
 *       **Note:** Deletion is immediate and cannot be undone. Use with caution.
 *     operationId: deleteFile
 *     tags:
 *       - Files & Folders
 *     responses:
 *       200:
 *         description: File deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "File deleted successfully"
 *                 filename:
 *                   type: string
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Deletion failed
 *
 * /api/files/download-token:
 *   post:
 *     summary: Generate secure download token
 *     description: |
 *       Generates a time-limited HMAC-signed token for downloading files without authentication headers.
 *       
 *       **Use cases:**
 *       - Sharing download links with external users
 *       - Browser-based downloads from VMs or scripts
 *       - Bypassing bearer token requirements
 *       
 *       **Token details:**
 *       - TTL: 5 minutes
 *       - HMAC-SHA256 signed
 *       - Path-bound (cannot be used for different files)
 *       - Single-use recommended
 *     operationId: generateDownloadToken
 *     tags:
 *       - Download
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               path:
 *                 type: string
 *                 description: Full file path to generate token for
 *                 example: "documents/report.pdf"
 *             required:
 *               - path
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: Base64url-encoded HMAC token
 *                   example: "cGF0aHxleHB8c2ln..."
 *                 expiresIn:
 *                   type: integer
 *                   description: Token TTL in seconds
 *                   example: 300
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Token generation failed
 *
 * /api/files/exists/{filePath}:
 *   get:
 *     summary: Check file existence
 *     description: Quickly checks if a file exists at the specified path without listing directory contents.
 *     operationId: checkFileExists
 *     tags:
 *       - Files & Folders
 *     parameters:
 *       - in: path
 *         name: filePath
 *         required: true
 *         schema:
 *           type: string
 *         description: File path to check (URL-encoded)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: File existence status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 exists:
 *                   type: boolean
 *                   example: true
 *       403:
 *         description: Insufficient permissions
 *
 * /api/files/folders/create:
 *   post:
 *     summary: Create new folder
 *     description: |
 *       Creates a new folder by uploading an internal .keep marker blob.
 *       
 *       **Features:**
 *       - Creates nested folder hierarchies
 *       - Uses .keep 0-byte marker for folder metadata
 *       - Supports any folder path depth
 *       
 *       **Permissions:** Uploader role or above required
 *     operationId: createFolder
 *     tags:
 *       - Folders
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               folderPath:
 *                 type: string
 *                 description: Full path for the new folder
 *                 example: "documents/reports/2026"
 *               parentPath:
 *                 type: string
 *                 description: Optional parent folder path
 *             required:
 *               - folderPath
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: Folder created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 folderPath:
 *                   type: string
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Folder creation failed
 *
 * /api/files/folders/{folderPath}:
 *   delete:
 *     summary: Delete empty folder
 *     description: |
 *       Deletes a folder if and only if it contains no files (only .keep markers are ignored).
 *       
 *       **Safety feature:** Prevents accidental deletion of folders with contents.
 *       Delete all files first, then delete the folder.
 *     operationId: deleteFolder
 *     tags:
 *       - Folders
 *     parameters:
 *       - in: path
 *         name: folderPath
 *         required: true
 *         schema:
 *           type: string
 *         description: Folder path to delete (URL-encoded)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Folder deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 folderPath:
 *                   type: string
 *       403:
 *         description: Insufficient permissions
 *       409:
 *         description: Folder is not empty - delete contents first
 *       500:
 *         description: Folder deletion failed
 *
 * /api/files/move:
 *   post:
 *     summary: Move file to new location
 *     description: |
 *       Moves a file to a new location using server-side copy.
 *       
 *       **Features:**
 *       - Atomic operation (fail-safe)
 *       - Server-side copy (no data transfer through client)
 *       - Can move across folders
 *     operationId: moveFile
 *     tags:
 *       - Files & Folders
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sourcePath:
 *                 type: string
 *                 description: Current file path
 *                 example: "documents/old_location/file.pdf"
 *               destPath:
 *                 type: string
 *                 description: New file path
 *                 example: "documents/new_location/file.pdf"
 *             required:
 *               - sourcePath
 *               - destPath
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: File moved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 newPath:
 *                   type: string
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Source file not found
 *       500:
 *         description: Move operation failed
 *
 * /api/files/rename:
 *   post:
 *     summary: Rename file
 *     description: |
 *       Renames a file in its current directory using server-side copy.
 *       
 *       **Usage:** Provide the current path and new name (not full path).
 *     operationId: renameFile
 *     tags:
 *       - Files & Folders
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filePath:
 *                 type: string
 *                 description: Current file path
 *                 example: "documents/old_name.pdf"
 *               newName:
 *                 type: string
 *                 description: New file name (not full path)
 *                 example: "new_name.pdf"
 *             required:
 *               - filePath
 *               - newName
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: File renamed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 newPath:
 *                   type: string
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Rename failed
 *
 * /api/files/chunked/commit:
 *   post:
 *     summary: Commit chunked upload
 *     description: |
 *       Finalizes a multi-chunk file upload by assembling all chunks into the final blob.
 *       
 *       **Workflow:**
 *       1. Upload each chunk via POST /api/files with uploadId, chunkIndex, totalChunks
 *       2. After all chunks uploaded, call this endpoint to commit
 *       3. Chunks are assembled server-side into single file
 *       
 *       **Note:** Only call after all chunks have been successfully uploaded.
 *     operationId: commitChunkedUpload
 *     tags:
 *       - Upload
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               uploadId:
 *                 type: string
 *                 description: Unique upload session ID used in chunk uploads
 *                 example: "uuid-12345"
 *               fileName:
 *                 type: string
 *                 description: Target file name
 *                 example: "large_video.mp4"
 *               folderPath:
 *                 type: string
 *                 description: Optional target folder
 *                 example: "media/videos"
 *               totalChunks:
 *                 type: integer
 *                 description: Total number of chunks uploaded
 *                 example: 50
 *               contentType:
 *                 type: string
 *                 description: MIME type
 *                 example: "video/mp4"
 *             required:
 *               - uploadId
 *               - fileName
 *               - totalChunks
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Chunks committed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 filePath:
 *                   type: string
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Commit failed
 */

module.exports = {};

