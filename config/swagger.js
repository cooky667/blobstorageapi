const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

// Create swagger options with dynamic server URL
const createSwaggerOptions = () => {
  const apiUrl = process.env.API_URL || 'http://localhost:3001';
  
  return {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Storage Wrapper API',
        version: '1.0.0',
        description: 'Enterprise-grade API for managing files and folders in Azure Blob Storage with role-based access control, streaming uploads/downloads, and secure token-based access',
        contact: {
          name: 'API Support',
        },
      },
      servers: [
        {
          url: apiUrl,
          description: 'Production Storage API Server',
        },
      ],
      tags: [
        {
          name: 'Authentication',
          description: 'Information about API authentication',
        },
        {
          name: 'Files & Folders',
          description: 'File and folder operations',
        },
        {
          name: 'Download',
          description: 'File download and token management',
        },
      ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Azure Entra ID (formerly Azure AD) JWT token. Obtain via OAuth 2.0 authorization code flow. Token includes user roles (Reader, Uploader, Admin) in claims.',
        },
        DownloadToken: {
          type: 'apiKey',
          in: 'query',
          name: 'dt',
          description: 'HMAC-SHA256 signed token for time-limited file downloads without Bearer token. Generated via POST /api/files/download-token. TTL: 5 minutes. Add as query parameter: ?dt=<token>',
        },
      },
      schemas: {
        FileInfo: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name' },
            fullPath: { type: 'string', description: 'Full path in storage' },
            size: { type: 'integer', description: 'File size in bytes' },
            created: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
            type: { type: 'string', enum: ['file'] },
          },
        },
        FolderInfo: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Folder name' },
            path: { type: 'string', description: 'Full folder path' },
            type: { type: 'string', enum: ['folder'] },
            children: { type: 'integer', description: 'Number of items in folder (excluding .keep markers)' },
          },
        },
        FileListResponse: {
          type: 'object',
          properties: {
            currentPath: { type: 'string', description: 'Current folder path or /' },
            folders: {
              type: 'array',
              items: { $ref: '#/components/schemas/FolderInfo' },
            },
            files: {
              type: 'array',
              items: { $ref: '#/components/schemas/FileInfo' },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Error message' },
            details: { type: 'string', description: 'Additional error details' },
          },
        },
      },
    },
    security: [
      { BearerAuth: [] },
      { DownloadToken: [] },
    ],
  },
  apis: [path.join(__dirname, '../swagger-docs.js'), path.join(__dirname, '../routes/blob.js')],
  };
};

const options = createSwaggerOptions();
const specs = swaggerJsdoc(options);

module.exports = specs;
