import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import Razorpay from 'razorpay';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import twilio from 'twilio';
import crypto from 'crypto';
import pkg from 'pg';
const { Pool } = pkg;

// ------------------- Config -------------------
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(bodyParser.json());
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

// Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Twilio client
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ------------------- Helper: JWT -------------------
function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ------------------- PostgreSQL Database -------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  return rows[0];
}

async function createUser(email, password, phone = '') {
  const { rows } = await pool.query(
    'INSERT INTO users (email, password, phone, subscription_status) VALUES ($1,$2,$3,$4) RETURNING *',
    [email, password, phone, 'free']
  );
  return rows[0];
}



// 1️⃣ LIVE DATA
app.get('/api/live-data', async (req, res) => {
  try {
    const nifty = { price: 25142 + Math.floor(Math.random()*100-50), change: 40, changePercent: 0.16 };
    const sensex = { price: 82700 + Math.floor(Math.random()*100-50), change: 110, changePercent: 0.13 };
    const vix = 18.5 + (Math.random() - 0.5) * 0.5;
    res.json({ nifty, sensex, vix });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch live data' });
  }
});

// 2️⃣ MAX PAIN
app.get('/api/max-pain', (req, res) => {
  try {
    const spot = 25142;
    const maxPain = 25150;
    const chartData = {
      labels: ['25000','25050','25100','25150','25200','25250'],
      values: [430, 380, 290, 220, 280, 350]
    };
    res.json({ spot, maxPain, distance: maxPain - spot, chartData });
  } catch (err) {
    res.status(500).json({ error: 'Error generating max pain data' });
  }
});

// 3️⃣ GREEKS CALCULATOR
app.post('/api/greeks', (req, res) => {
  const { spot, strike, daysToExpiry, volatility } = req.body;
  const T = daysToExpiry / 365;
  const sigma = volatility / 100;
  const r = 0.065;

  try {
    const d1 = (Math.log(spot / strike) + (r + sigma ** 2 / 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    const N = x => 0.5 * (1 + Math.erf(x / Math.sqrt(2)));
    const n = x => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

    const callPrice = spot * N(d1) - strike * Math.exp(-r * T) * N(d2);
    const putPrice = strike * Math.exp(-r * T) * N(-d2) - spot * N(-d1);
    const delta = N(d1);
    const gamma = n(d1) / (spot * sigma * Math.sqrt(T));
    const theta = -(spot * n(d1) * sigma / (2 * Math.sqrt(T))) - r * strike * Math.exp(-r * T) * N(d2);
    const vega = spot * n(d1) * Math.sqrt(T);

    res.json({ callPrice, putPrice, delta, gamma, theta, vega });
  } catch (err) {
    res.status(400).json({ error: 'Invalid parameters' });
  }
});

// 4️⃣ USER SIGNUP (PostgreSQL)
app.post('/api/signup', async (req, res) => {
  const { email, password, phone } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const existing = await findUserByEmail(email);
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const user = await createUser(email, password, phone);
    const token = generateToken(user);
    res.json({ success: true, user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 5️⃣ LOGIN (PostgreSQL)
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await findUserByEmail(email);
    if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
    const token = generateToken(user);
    res.json({ success: true, user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 6️⃣ CURRENT USER
app.get('/api/user', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 7️⃣ CREATE ORDER (Razorpay)
app.post('/api/create-order', async (req, res) => {
  const { amount, subscription_type } = req.body;
  if (!amount) return res.status(400).json({ error: 'Amount required' });
  try {
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: 'INR',
      receipt: `order_${Date.now()}`,
      notes: { plan: subscription_type || 'pro' }
    });
    res.json({
      success: true,
      orderId: order.id,
      amount,
      currency: 'INR',
      razorpayKeyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create Razorpay order' });
  }
});

// 8️⃣ VERIFY PAYMENT
app.post('/api/verify-payment', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const sign = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');
    if (sign === razorpay_signature) {
      try {
        twilioClient.messages.create({
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
          to: `whatsapp:+919999999999`,
          body: `✅ Payment received! Your FinOp Partners subscription is active.`
        });
      } catch (twErr) { console.warn('Twilio send failed:', twErr.message); }

      res.json({ success: true, subscriptionEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
    } else {
      res.status(400).json({ error: 'Signature mismatch' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ------------------- START -------------------
app.listen(PORT, () => {
  console.log(`✅ FinOp backend running on port ${PORT}`);
});
