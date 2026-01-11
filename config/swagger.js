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
        'x-documentation': {
          'authentication': '# Authentication & Authorization\n\nThis API uses two authentication mechanisms:\n\n## 1. Bearer Token Authentication\nAll endpoints (except public downloads) require Azure Entra ID JWT tokens.\n\n**Obtaining a token:**\n- Use OAuth 2.0 Authorization Code flow with your Azure Entra ID app registration\n- Frontend SPA should handle auth via MSAL (Microsoft Authentication Library)\n- Token includes user roles in claims\n\n**Using the token:**\n- Add to all requests: `Authorization: Bearer <token>`\n- Example: `curl -H "Authorization: Bearer eyJhbGc..." https://api.example.com/api/files`\n\n**Role-based access:**\n- **Reader**: List files, download files, generate download tokens\n- **Uploader**: All Reader permissions + upload files, create folders\n- **Admin**: All permissions + delete files/folders, manage access\n\n## 2. Download Token Authentication\nFor sharing downloads without bearer tokens (external users, scripts, VMs).\n\n**Obtaining a download token:**\n- Call `POST /api/files/download-token` with Bearer auth\n- Returns HMAC-signed token valid for 5 minutes\n- Path-bound (cannot be reused for different files)\n\n**Using the token:**\n- Add to download URL: `https://api.example.com/api/files/download/path?dt=<token>`\n- No Authorization header needed\n- Example: `curl https://api.example.com/api/files/download/docs/report.pdf?dt=abc123...`\n\n## Error Codes\n- `401 Unauthorized`: Missing or invalid Bearer token\n- `403 Forbidden`: Insufficient role permissions for this operation\n- `404 Not Found`: File/folder does not exist\n- `429 Too Many Requests`: Rate limited (retry after delay)',
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
          description: 'API authentication uses Azure Entra ID Bearer tokens (OAuth 2.0) or time-limited HMAC-signed download tokens. All endpoints require authentication except public downloads with valid token. Three role levels: Reader (read-only), Uploader (+ write), Admin (+ delete). Download tokens have 5-minute TTL and are path-bound.',
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
