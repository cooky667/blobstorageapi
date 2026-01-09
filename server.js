require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authMiddleware = require('./middleware/auth');
const blobRoutes = require('./routes/blob');

const app = express();
app.use(express.json());

// CORS: allow configured origins (SWA + localhost)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : '*' }));
app.options('*', cors());

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
