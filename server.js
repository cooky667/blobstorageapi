require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

// Health check (no auth)
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Auth middleware for all other routes
app.use(authMiddleware);

// JSON parser only for commit endpoint (not for multipart uploads)
app.use('/api/files/chunked/commit', express.json());

// Blob routes
app.use('/api/files', blobRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
