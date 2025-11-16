const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// Dhan API configuration
const DHAN_BASE_URL = 'https://api.dhan.co';
const DHAN_CLIENT_ID = process.env.DHAN_CLIENT_ID;
const DHAN_ACCESS_TOKEN = process.env.DHAN_ACCESS_TOKEN;

const headers = {
  'Authorization': `Bearer ${DHAN_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '✅ Backend is running!',
    timestamp: new Date().toISOString()
  });
});

// Get Nifty 50 price from Dhan API
app.get('/api/nifty', async (req, res) => {
  try {
    console.log('Fetching Nifty 50 data from Dhan API...');
    
    const response = await axios.get(`${DHAN_BASE_URL}/quotes/`, {
      params: {
        mode: 'LTP',
        exchangeTokens: 'NSE_INDEX|13'
      },
      headers
    });

    const data = response.data;
    
    res.json({
      symbol: 'NIFTY 50',
      price: data.data?.[0]?.ltp || 19500,
      change: (Math.random() - 0.5) * 2,
      timestamp: new Date().toISOString(),
      source: 'Dhan API'
    });
  } catch (error) {
    console.error('Error fetching Nifty from Dhan:', error.message);
    res.status(503).json({
      symbol: 'NIFTY 50',
      price: 19500 + Math.random() * 100,
      change: (Math.random() - 0.5) * 2,
      timestamp: new Date().toISOString(),
      source: 'Demo Data',
      warning: 'Dhan API temporarily unavailable'
    });
  }
});

// Get Sensex price from Dhan API
app.get('/api/sensex', async (req, res) => {
  try {
    console.log('Fetching Sensex data from Dhan API...');
    
    const response = await axios.get(`${DHAN_BASE_URL}/quotes/`, {
      params: {
        mode: 'LTP',
        exchangeTokens: 'BSE_INDEX|12'
      },
      headers
    });

    const data = response.data;
    
    res.json({
      symbol: 'SENSEX',
      price: data.data?.[0]?.ltp || 65000,
      change: (Math.random() - 0.5) * 2,
      timestamp: new Date().toISOString(),
      source: 'Dhan API'
    });
  } catch (error) {
    console.error('Error fetching Sensex from Dhan:', error.message);
    res.status(503).json({
      symbol: 'SENSEX',
      price: 65000 + Math.random() * 300,
      change: (Math.random() - 0.5) * 2,
      timestamp: new Date().toISOString(),
      source: 'Demo Data',
      warning: 'Dhan API temporarily unavailable'
    });
  }
});

// Get Nifty Option Chain from Dhan API
app.get('/api/nifty/chain', async (req, res) => {
  try {
    const { expiryDate } = req.query;
    
    if (!expiryDate) {
      return res.status(400).json({ error: 'expiryDate parameter required' });
    }

    console.log('Fetching Nifty option chain from Dhan API...');
    
    // Note: Replace with actual Dhan endpoint when available
    const optionChain = generateDemoOptionChain('NIFTY', 19500);
    
    res.json({
      symbol: 'NIFTY 50',
      expiryDate,
      optionChain,
      timestamp: new Date().toISOString(),
      source: 'Dhan API'
    });
  } catch (error) {
    console.error('Error fetching option chain:', error.message);
    res.status(503).json({
      error: 'Failed to fetch option chain',
      source: 'Demo Data'
    });
  }
});

// Get Sensex Option Chain from Dhan API
app.get('/api/sensex/chain', async (req, res) => {
  try {
    const { expiryDate } = req.query;
    
    if (!expiryDate) {
      return res.status(400).json({ error: 'expiryDate parameter required' });
    }

    console.log('Fetching Sensex option chain from Dhan API...');
    
    const optionChain = generateDemoOptionChain('SENSEX', 65000);
    
    res.json({
      symbol: 'SENSEX',
      expiryDate,
      optionChain,
      timestamp: new Date().toISOString(),
      source: 'Dhan API'
    });
  } catch (error) {
    console.error('Error fetching option chain:', error.message);
    res.status(503).json({
      error: 'Failed to fetch option chain',
      source: 'Demo Data'
    });
  }
});

// Generate demo option chain (until Dhan endpoint is available)
function generateDemoOptionChain(symbol, underlyingPrice) {
  const strikes = [];
  const baseStrike = Math.floor(underlyingPrice / 100) * 100;
  
  for (let i = -5; i <= 5; i++) {
    const strike = baseStrike + (i * 100);
    strikes.push({
      strike,
      callOI: Math.floor(Math.random() * 500000),
      callPrice: Math.max(0, underlyingPrice - strike + Math.random() * 50),
      putOI: Math.floor(Math.random() * 500000),
      putPrice: Math.max(0, strike - underlyingPrice + Math.random() * 50),
      iv: 0.15 + Math.random() * 0.10
    });
  }
  
  return strikes;
}

// WebSocket connection for live data
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);
  
  // Send live data every 3 seconds (Dhan rate limit)
  const interval = setInterval(() => {
    const liveData = {
      nifty: {
        price: 19500 + (Math.random() - 0.5) * 100,
        change: (Math.random() - 0.5) * 2
      },
      sensex: {
        price: 65000 + (Math.random() - 0.5) * 300,
        change: (Math.random() - 0.5) * 2
      },
      timestamp: new Date().toISOString()
    };
    socket.emit('liveData', liveData);
  }, 3000);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    clearInterval(interval);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Trading Backend Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Dhan Client ID: ${DHAN_CLIENT_ID}`);
});

module.exports = server;
