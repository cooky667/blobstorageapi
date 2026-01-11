require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
const authMiddleware = require('./middleware/auth');
const blobRoutes = require('./routes/blob');

const app = express();
// Note: No express.json() globally for file uploads - multer/busboy handle multipart/form-data
// But we need it for specific JSON endpoints like chunked commit

// CORS: allow configured origins (SWA + localhost)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: allowedOrigins.length ? allowedOrigins : '*',
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

console.log('CORS configured for origins:', allowedOrigins.length ? allowedOrigins : 'all (*)')

app.use(cors(corsOptions));

// Swagger/OpenAPI documentation (no auth required)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, { 
  swaggerOptions: { 
    persistAuthorization: true,
    defaultModelsExpandDepth: 1,
  },
}));

// Swagger spec endpoint (no auth required)
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpecs);
});

// Health check (no auth)
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Diagnostic endpoint for chunked upload (no auth)
app.post('/api/files/chunked/test', (req, res) => {
  try {
    res.json({ 
      status: 'OK', 
      query: req.query,
      contentType: req.headers['content-type'],
      hasAuth: !!req.headers.authorization 
    });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Auth middleware for all other routes
app.use(authMiddleware);

// JSON parser for endpoints that need it (commit, folder operations, rename, move)
// This is applied after auth but before routes
app.use(express.json());

// Blob routes
app.use('/api/files', blobRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
