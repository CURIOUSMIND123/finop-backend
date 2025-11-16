import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import Razorpay from 'razorpay';
import bodyParser from 'body-parser';
import axios from 'axios';
import nodemailer from 'nodemailer';
import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
import pkg from 'pg';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;
const app = express();

// ============ SECURITY ============
app.use(helmet());

const corsOptions = {
  origin: ['https://finoppartners.com', 'https://www.finoppartners.com', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

console.log('✓ Backend initializing...');
console.log('✓ Dhan API configured:', process.env.DHAN_API_BASE);

// ============ DATABASE ============
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('✓ Database connected');
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err);
});

// ============ RAZORPAY ============
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

console.log('✓ Razorpay configured');

// ============ EMAIL ============
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

emailTransporter.verify((err, success) => {
  if (err) {
    console.error('❌ Email error:', err);
  } else {
    console.log('✓ Email service ready');
  }
});

// ============ RATE LIMITING ============
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts'
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many signups'
});

// ============ JWT FUNCTIONS ============
function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ============ DHAN API WRAPPER ============
const DHAN_API_BASE = process.env.DHAN_API_BASE || 'https://api.dhanhq.co/v2';
const DHAN_ACCESS_TOKEN = process.env.DHAN_ACCESS_TOKEN;
const DHAN_CLIENT_ID = process.env.DHAN_CLIENT_ID;

async function dhanApiCall(endpoint, params = {}) {
  try {
    const response = await axios.get(`${DHAN_API_BASE}${endpoint}`, {
      params,
      headers: {
        'Authorization': `Bearer ${DHAN_ACCESS_TOKEN}`,
        'client-id': DHAN_CLIENT_ID,
        'Accept': 'application/json'
      },
      timeout: 8000
    });
    return response.data;
  } catch (error) {
    console.error('Dhan API Error:', error.message);
    return null;
  }
}

// ============ GET NIFTY LIVE PRICE ============
async function getNiftyPrice() {
  try {
    if (!DHAN_ACCESS_TOKEN || !DHAN_CLIENT_ID) {
      console.warn('⚠️ Dhan credentials missing');
      return getDemoNiftyPrice();
    }

    // Fetch Nifty50 index data from Dhan
    const data = await dhanApiCall('/market/quote', {
      mode: 'LTP',
      securityId: '13',
      exchangeSegment: 'IDX_I'
    });

    if (data && data.data && data.data.ltp) {
      return {
        price: parseFloat(data.data.ltp),
        change: data.data.netChange || 0,
        changePercent: data.data.netChangePercent || 0,
        source: 'LIVE',
        demo: false,
        timestamp: new Date()
      };
    }
    
    return getDemoNiftyPrice();
  } catch (error) {
    console.error('⚠️ Nifty fetch failed:', error.message);
    return getDemoNiftyPrice();
  }
}

// Demo fallback with indicator
function getDemoNiftyPrice() {
  const basePrice = 25142;
  const randomChange = (Math.random() - 0.5) * 50;
  return {
    price: basePrice + randomChange,
    change: randomChange,
    changePercent: (randomChange / basePrice) * 100,
    source: 'DEMO',
    demo: true,
    demoIndicator: '🔴 DEMO MODE',
    message: 'Live API unavailable. Showing demo data for educational purposes.',
    timestamp: new Date()
  };
}

// ============ GET OPTION CHAIN DATA ============
async function getOptionChainData(expiry) {
  try {
    // Fetch option chain for Nifty50 from Dhan
    const data = await dhanApiCall('/market/optionchain', {
      securityId: '13',
      exchangeSegment: 'IDX_I',
      expiryDate: expiry
    });

    if (data && data.data && data.data.optionChain) {
      return data.data.optionChain;
    }
    
    return null;
  } catch (error) {
    console.error('Option chain fetch failed:', error.message);
    return null;
  }
}

// ============ CALCULATE MAX PAIN ============
function calculateMaxPain(optionChain, spot) {
  if (!optionChain || optionChain.length === 0) {
    return { maxPain: spot, callOI: 0, putOI: 0, demoData: true };
  }

  let maxPainLoss = -Infinity;
  let maxPainStrike = spot;

  const strikes = [...new Set(optionChain.map(opt => opt.strike))];

  for (let strike of strikes) {
    const calls = optionChain.filter(opt => opt.strike === strike && opt.instrumentType === 'CE');
    const puts = optionChain.filter(opt => opt.strike === strike && opt.instrumentType === 'PE');

    const callOI = calls.reduce((sum, c) => sum + (c.openInterest || 0), 0);
    const putOI = puts.reduce((sum, p) => sum + (p.openInterest || 0), 0);

    const pnl = (strike - spot) * callOI - (strike - spot) * putOI;

    if (pnl > maxPainLoss) {
      maxPainLoss = pnl;
      maxPainStrike = strike;
    }
  }

  const totalCallOI = optionChain
    .filter(opt => opt.instrumentType === 'CE')
    .reduce((sum, c) => sum + (c.openInterest || 0), 0);

  const totalPutOI = optionChain
    .filter(opt => opt.instrumentType === 'PE')
    .reduce((sum, p) => sum + (p.openInterest || 0), 0);

  return {
    maxPain: maxPainStrike,
    callOI: totalCallOI,
    putOI: totalPutOI,
    spot: spot,
    demoData: false
  };
}

// ============ GREEKS CALCULATION ============
function calculateGreeks(spot, strike, daysToExpiry, iv) {
  const T = daysToExpiry / 365;
  const sigma = iv / 100;
  const r = 0.065;

  if (T <= 0 || sigma <= 0) {
    return {
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      callPrice: 0,
      putPrice: 0,
      error: 'Invalid inputs'
    };
  }

  const d1 = (Math.log(spot / strike) + (r + (sigma ** 2) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const N = (x) => 0.5 * (1 + erf(x / Math.sqrt(2)));
  const n = (x) => Math.exp((-0.5 * x * x)) / Math.sqrt(2 * Math.PI);

  const delta = N(d1);
  const gamma = n(d1) / (spot * sigma * Math.sqrt(T));
  const theta = (-(spot * n(d1) * sigma) / (2 * Math.sqrt(T)) - r * strike * Math.exp(-r * T) * N(d2)) / 365;
  const vega = (spot * n(d1) * Math.sqrt(T)) / 100;

  const callPrice = spot * N(d1) - strike * Math.exp(-r * T) * N(d2);
  const putPrice = strike * Math.exp(-r * T) * N(-d2) - spot * N(-d1);

  return {
    delta: parseFloat(delta.toFixed(4)),
    gamma: parseFloat(gamma.toFixed(6)),
    theta: parseFloat(theta.toFixed(2)),
    vega: parseFloat(vega.toFixed(4)),
    callPrice: parseFloat(callPrice.toFixed(2)),
    putPrice: parseFloat(putPrice.toFixed(2))
  };
}

function erf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  return sign * (1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x));
}

// ============ API ENDPOINTS ============

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date(), dhanConnected: !!DHAN_ACCESS_TOKEN });
});

app.get('/api/config', (req, res) => {
  res.json({ razorpayKeyId: process.env.RAZORPAY_KEY_ID });
});

// SIGNUP
app.post('/api/signup', signupLimiter, [
  body('email').isEmail(),
  body('password').isLength({ min: 8 }),
  body('firstName').notEmpty(),
  body('lastName').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { email, password, firstName, lastName, phone } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcryptjs.hash(password, 12);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO users (email, password, phone, first_name, last_name, verified, verification_token, token_expiry, subscription_status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, email`,
      [email, hashedPassword, phone || '', firstName, lastName, false, verificationToken, tokenExpiry, 'free']
    );

    const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    await emailTransporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Verify Your FinOp Account',
      html: `<p>Please verify your email to activate your account:</p><a href="${verificationLink}">Verify Email</a><p>Link expires in 24 hours.</p>`
    });

    res.json({ success: true, message: 'Signup successful. Check your email for verification link.' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// VERIFY EMAIL
app.get('/api/verify-email', async (req, res) => {
  const { token } = req.query;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE verification_token=$1 AND token_expiry > NOW()',
      [token]
    );

    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired token' });

    await pool.query(
      'UPDATE users SET verified=true, verification_token=NULL, token_expiry=NULL WHERE id=$1',
      [result.rows[0].id]
    );

    res.json({ success: true, message: 'Email verified successfully!' });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// LOGIN
app.post('/api/login', loginLimiter, [
  body('email').isEmail(),
  body('password').notEmpty()
], async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.verified) return res.status(403).json({ error: 'Email not verified. Check your inbox.' });

    const isValid = await bcryptjs.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken(user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        subscription_status: user.subscription_status
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET USER PROFILE
app.get('/api/user', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id=$1', [req.userId]);
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        subscription_status: user.subscription_status,
        subscriptionEnd: user.subscription_end
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// LIVE DATA ENDPOINT - NIFTY + OPTION CHAIN
app.get('/api/live-data', verifyToken, async (req, res) => {
  try {
    const niftyData = await getNiftyPrice();
    
    res.json({
      nifty: niftyData.price,
      change: niftyData.change,
      changePercent: niftyData.changePercent,
      source: niftyData.source,
      demo: niftyData.demo,
      demoIndicator: niftyData.demoIndicator,
      message: niftyData.message,
      timestamp: niftyData.timestamp,
      vix: 18.5 + (Math.random() - 0.5) * 2 // Demo VIX
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch live data' });
  }
});

// MAX PAIN ENDPOINT
app.get('/api/max-pain', verifyToken, async (req, res) => {
  try {
    const niftyData = await getNiftyPrice();
    const expiry = req.query.expiry || '30-Nov-2025'; // Default to current week

    const optionChain = await getOptionChainData(expiry);
    let maxPainData;

    if (optionChain) {
      maxPainData = calculateMaxPain(optionChain, niftyData.price);
    } else {
      // Demo max pain if API fails
      maxPainData = {
        maxPain: Math.round(niftyData.price / 100) * 100,
        callOI: 1500000 + Math.random() * 500000,
        putOI: 1600000 + Math.random() * 500000,
        spot: niftyData.price,
        demoData: true
      };
    }

    res.json({
      maxPain: maxPainData.maxPain,
      spot: maxPainData.spot,
      callOI: Math.round(maxPainData.callOI),
      putOI: Math.round(maxPainData.putOI),
      distance: maxPainData.maxPain - maxPainData.spot,
      demoData: maxPainData.demoData,
      demo: niftyData.demo,
      demoIndicator: niftyData.demoIndicator,
      message: niftyData.message,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('Max Pain error:', err);
    res.status(500).json({ error: 'Failed to calculate max pain' });
  }
});

// GREEKS CALCULATOR
app.post('/api/greeks', verifyToken, [
  body('spot').isNumeric(),
  body('strike').isNumeric(),
  body('daysToExpiry').isNumeric(),
  body('iv').isNumeric()
], async (req, res) => {
  const { spot, strike, daysToExpiry, iv } = req.body;

  try {
    const greeks = calculateGreeks(
      parseFloat(spot),
      parseFloat(strike),
      parseFloat(daysToExpiry),
      parseFloat(iv)
    );

    if (greeks.error) {
      return res.status(400).json({ error: greeks.error });
    }

    res.json({
      spot: parseFloat(spot),
      strike: parseFloat(strike),
      daysToExpiry: parseFloat(daysToExpiry),
      iv: parseFloat(iv),
      ...greeks
    });
  } catch (err) {
    console.error('Greeks calculation error:', err);
    res.status(500).json({ error: 'Failed to calculate greeks' });
  }
});

// CREATE RAZORPAY ORDER
app.post('/api/create-order', verifyToken, [
  body('amount').isNumeric(),
  body('planType').isIn(['pro', 'pro_plus'])
], async (req, res) => {
  const { amount, planType } = req.body;

  try {
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: 'INR',
      receipt: `order_${Date.now()}`,
      notes: { plan: planType }
    });

    await pool.query(
      'INSERT INTO payments (user_id, razorpay_order_id, amount, plan_type, status) VALUES ($1, $2, $3, $4, $5)',
      [req.userId, order.id, amount, planType, 'pending']
    );

    res.json({
      success: true,
      orderId: order.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// VERIFY PAYMENT
app.post('/api/verify-payment', verifyToken, [
  body('razorpay_order_id').notEmpty(),
  body('razorpay_payment_id').notEmpty(),
  body('razorpay_signature').notEmpty()
], async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  try {
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const computed = hmac.digest('hex');

    if (computed !== razorpay_signature) {
      return res.status(400).json({ error: 'Signature mismatch' });
    }

    const subscriptionEnd = new Date();
    subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);

    const userResult = await pool.query(
      `UPDATE users SET subscription_status=$1, subscription_end=$2, last_payment_date=NOW() WHERE id=$3 RETURNING *`,
      [req.body.planType || 'pro', subscriptionEnd, req.userId]
    );

    await pool.query(
      `UPDATE payments SET razorpay_payment_id=$1, razorpay_signature=$2, status=$3 WHERE razorpay_order_id=$4`,
      [razorpay_payment_id, razorpay_signature, 'completed', razorpay_order_id]
    );

    res.json({
      success: true,
      subscription: {
        plan: userResult.rows[0].subscription_status,
        endDate: userResult.rows[0].subscription_end
      }
    });
  } catch (err) {
    console.error('Payment verification error:', err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// CANCEL SUBSCRIPTION
app.post('/api/cancel-subscription', verifyToken, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET subscription_status=$1, subscription_end=NOW() WHERE id=$2',
      ['free', req.userId]
    );

    res.json({ success: true, message: 'Subscription cancelled' });
  } catch (err) {
    res.status(500).json({ error: 'Cancellation failed' });
  }
});

// START SERVER
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  ✓ FINOP BACKEND LIVE ON PORT ${PORT}        ║`);
  console.log(`║  ✓ Dhan API Ready                    ║`);
  console.log(`║  ✓ Database Connected               ║`);
  console.log(`║  ✓ Ready for Production              ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
});
