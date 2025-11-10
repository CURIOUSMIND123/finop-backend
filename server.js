const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

let liveData = {
  maxPain: 25150,
  spot: 25142,
  vix: 18.5,
  lastUpdate: new Date().toISOString()
};

// Update live data every 60 seconds
async function fetchLiveData() {
  try {
    liveData.maxPain = Math.floor(Math.random() * 50) + 25100;
    liveData.spot = Math.floor(Math.random() * 100) + 25100;
    liveData.lastUpdate = new Date().toISOString();
  } catch (error) {
    console.log('Data fetch error');
  }
}

setInterval(fetchLiveData, 60000);

// API: Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running!' });
});

// API: Get Max Pain
app.get('/api/max-pain', (req, res) => {
  res.json(liveData);
});

// API: Greeks Calculator
app.post('/api/greeks', (req, res) => {
  const { spot, strike, daysToExpiry, volatility } = req.body;
  
  const T = daysToExpiry / 365;
  const sigma = volatility / 100;
  const r = 0.065;
  
  const sqrtT = Math.sqrt(T);
  const denominator = sigma * sqrtT;
  
  if (denominator === 0) {
    return res.json({ error: 'Invalid parameters' });
  }
  
  const d1 = (Math.log(spot / strike) + (r + (sigma * sigma) / 2) * T) / denominator;
  const d2 = d1 - sigma * sqrtT;
  
  const N = (x) => {
    return (1 + Math.erf(x / Math.sqrt(2))) / 2;
  };
  
  const phi = (x) => {
    return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
  };
  
  const call = spot * N(d1) - strike * Math.exp(-r * T) * N(d2);
  const put = strike * Math.exp(-r * T) * N(-d2) - spot * N(-d1);
  
  const delta = N(d1);
  const gamma = phi(d1) / (spot * sigma * sqrtT);
  const theta = -(spot * phi(d1) * sigma) / (2 * sqrtT) - r * strike * Math.exp(-r * T) * N(d2);
  const vega = spot * phi(d1) * sqrtT;
  
  res.json({
    callPrice: parseFloat(call.toFixed(2)),
    putPrice: parseFloat(put.toFixed(2)),
    delta: parseFloat(delta.toFixed(4)),
    gamma: parseFloat(gamma.toFixed(6)),
    theta: parseFloat((theta / 365).toFixed(2)),
    vega: parseFloat(vega.toFixed(2))
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Backend running on port ' + PORT);
});
