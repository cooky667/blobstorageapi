require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authMiddleware = require('./middleware/auth');
const blobRoutes = require('./routes/blob');

const app = express();
// Note: No express.json() for file uploads - multer handles multipart/form-data
// Only add express.json() if you need JSON endpoints in the future

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

// Blob routes
app.use('/api/files', blobRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
