const express = require('express');
const cors = require('cors');
const analyzeRoutes = require('./routes/analyze');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    service: 'EV2 TikTok Analyzer',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/tiktok', analyzeRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`🎵 EV2 TikTok Analyzer running on port ${PORT}`);
});
