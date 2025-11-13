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

console.log('Using DATABASE:', process.env.DATABASE_URL?.substring(0, 30) + '...');
console.log('Using EMAIL:', process.env.EMAIL_USER);
console.log('Using RAZORPAY KEY:', process.env.RAZORPAY_KEY_ID);

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

// Verify email connection
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

// ============ DHAN API ============
const DHAN_API_URL = 'https://api.dhanhq.co/v1';

async function getNiftyPrice() {
  try {
    if (!process.env.DHAN_ACCESS_TOKEN || !process.env.DHAN_CLIENT_ID) {
      console.warn('Dhan credentials missing, using demo');
      return getDemoPrice();
    }

    const response = await axios.get(`${DHAN_API_URL}/market/quote`, {
      params: { mode: 'LTP', securityId: '13', exchangeSegment: 'IDX_I' },
      headers: {
        'Authorization': `Bearer ${process.env.DHAN_ACCESS_TOKEN}`,
        'client-id': process.env.DHAN_CLIENT_ID
      },
      timeout: 5000
    });
    
    return { price: response.data.ltp, source: 'LIVE', demo: false };
  } catch (error) {
    console.warn('⚠️ Dhan API failed:', error.message);
    return getDemoPrice();
  }
}

function getDemoPrice() {
  return { 
    price: 25142 + (Math.random() - 0.5) * 100, 
    source: 'DEMO', 
    demo: true,
    message: 'Demo data - Dhan API unavailable'
  };
}

// ============ GREEKS CALCULATION ============
function calculateGreeks(spot, strike, days, iv) {
  const T = days / 365;
  const sigma = iv / 100;
  const r = 0.065;
  
  const d1 = (Math.log(spot / strike) + (r + sigma ** 2 / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  
  const N = (x) => 0.5 * (1 + erf(x / Math.sqrt(2)));
  const n = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  
  const delta = N(d1);
  const gamma = n(d1) / (spot * sigma * Math.sqrt(T));
  const theta = -(spot * n(d1) * sigma) / (2 * Math.sqrt(T)) - r * strike * Math.exp(-r * T) * N(d2);
  const vega = spot * n(d1) * Math.sqrt(T);
  
  return { 
    delta: delta.toFixed(3), 
    gamma: gamma.toFixed(4), 
    theta: theta.toFixed(2), 
    vega: vega.toFixed(2),
    callPrice: (spot * N(d1) - strike * Math.exp(-r * T) * N(d2)).toFixed(2),
    putPrice: (strike * Math.exp(-r * T) * N(-d2) - spot * N(-d1)).toFixed(2)
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
  res.json({ status: 'OK', timestamp: new Date() });
});

// GET CONFIG (for frontend to get Razorpay key)
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
      html: `
        <h2>Welcome to FinOp Partners!</h2>
        <p>Please verify your email to activate your account:</p>
        <p><a href="${verificationLink}" style="background: #1E40AF; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a></p>
        <p>Link expires in 24 hours.</p>
      `
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
        subscription: user.subscription_status 
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
        subscription: user.subscription_status,
        subscriptionEnd: user.subscription_end
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// LIVE DATA (NIFTY + GREEKS)
app.get('/api/live-data', verifyToken, async (req, res) => {
  try {
    const priceData = await getNiftyPrice();
    
    res.json({
      nifty: priceData.price,
      source: priceData.source,
      demo: priceData.demo,
      message: priceData.message,
      timestamp: new Date()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch live data' });
  }
});

// CALCULATE GREEKS
app.post('/api/greeks', verifyToken, [
  body('strike').isNumeric(),
  body('days').isNumeric(),
  body('iv').isNumeric()
], async (req, res) => {
  const { strike, days, iv } = req.body;
  
  try {
    const priceData = await getNiftyPrice();
    const greeks = calculateGreeks(priceData.price, strike, days, iv);
    
    res.json({ 
      spot: priceData.price, 
      strike, 
      ...greeks,
      demo: priceData.demo
    });
  } catch (err) {
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
    // Verify signature
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const computed = hmac.digest('hex');
    
    if (computed !== razorpay_signature) {
      return res.status(400).json({ error: 'Signature mismatch' });
    }
    
    // Get order details from Razorpay
    const order = await razorpay.orders.fetch(razorpay_order_id);
    const planType = order.notes.plan;
    
    // Calculate subscription end date
    const subscriptionEnd = new Date();
    subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);
    
    // Update user subscription
    const userResult = await pool.query(
      `UPDATE users SET subscription_status=$1, subscription_end=$2, last_payment_date=NOW() 
       WHERE id=$3 RETURNING *`,
      [planType, subscriptionEnd, req.userId]
    );
    
    // Update payment record
    await pool.query(
      `UPDATE payments SET razorpay_payment_id=$1, razorpay_signature=$2, status=$3 
       WHERE razorpay_order_id=$4`,
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

// GET PAYMENT HISTORY
app.get('/api/payments', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
      [req.userId]
    );
    
    res.json({ payments: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// CANCEL SUBSCRIPTION
app.post('/api/cancel-subscription', verifyToken, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET subscription_status=$1, subscription_end=NOW() WHERE id=$2',
      ['free', req.userId]
    );
    
    res.json({ success: true, message: 'Subscription cancelled. You are now on Free tier.' });
  } catch (err) {
    res.status(500).json({ error: 'Cancellation failed' });
  }
});

// START SERVER
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓✓✓ SERVER RUNNING ON PORT ${PORT}`);
  console.log('✓ All credentials loaded from Render environment');
  console.log('✓ Ready to accept requests\n');
});
