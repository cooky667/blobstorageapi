const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Storage Wrapper API',
      version: '1.0.0',
      description: 'API for managing files and folders in Azure Blob Storage with role-based access control',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:3001',
        description: 'Storage API Server',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Azure Entra ID token',
        },
        DownloadToken: {
          type: 'apiKey',
          in: 'query',
          name: 'dt',
          description: 'HMAC-signed download token (5-minute TTL)',
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

const specs = swaggerJsdoc(options);

module.exports = specs;
