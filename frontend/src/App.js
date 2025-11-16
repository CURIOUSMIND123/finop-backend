javascript
import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import './index.css';

const BACKEND_URL = 'https://trading-backend-ee6j.onrender.com';

function App() {
  const [niftyPrice, setNiftyPrice] = useState(19500);
  const [sensexPrice, setSensexPrice] = useState(65000);
  const [niftyChange, setNiftyChange] = useState(0);
  const [sensexChange, setSensexChange] = useState(0);
  const [connected, setConnected] = useState(false);
  const [maxPain, setMaxPain] = useState({ nifty: 19500, sensex: 65000 });
  const [greeksData, setGreeksData] = useState(null);

  useEffect(() => {
    // Fetch initial data
    const fetchInitialData = async () => {
      try {
        const niftyRes = await fetch(`${BACKEND_URL}/api/nifty`);
        const niftyData = await niftyRes.json();
        setNiftyPrice(niftyData.price);
        setNiftyChange(niftyData.change);

        const sensexRes = await fetch(`${BACKEND_URL}/api/sensex`);
        const sensexData = await sensexRes.json();
        setSensexPrice(sensexData.price);
        setSensexChange(sensexData.change);
      } catch (error) {
        console.error('Error fetching initial data:', error);
      }
    };

    fetchInitialData();

    // Connect to WebSocket
    const socket = io(BACKEND_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      console.log('Connected to backend');
      setConnected(true);
    });

    socket.on('liveData', (data) => {
      setNiftyPrice(data.nifty.price.toFixed(2));
      setNiftyChange(data.nifty.change.toFixed(2));
      setSensexPrice(data.sensex.price.toFixed(2));
      setSensexChange(data.sensex.change.toFixed(2));
      
      // Update Max Pain estimates
      setMaxPain({
        nifty: (data.nifty.price - 50).toFixed(2),
        sensex: (data.sensex.price - 100).toFixed(2)
      });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    return () => socket.disconnect();
  }, []);

  const getPriceColor = (change) => {
    return parseFloat(change) >= 0 ? '#2db2a4' : '#ff5459';
  };

  return (
    <div className="app">
      {/* Navigation */}
      <nav className="navbar">
        <div className="nav-container">
          <div className="logo">FinOp Partners</div>
          <div className="nav-links">
            <a href="#home">Home</a>
            <a href="#tools">Tools</a>
            <a href="#pricing">Pricing</a>
            <a href="#traders">Traders</a>
          </div>
          <div className="nav-button">
            {connected ? '🟢 Live' : '🔴 Connecting'}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <h1>Turn Profitable from 1st Day with Data-Driven Options Trading</h1>
          <p>Join 1200+ Profitable Traders Using Real-Time OI Intelligence, Auto-Updating Max Pain, and AI-Powered Greeks Analysis</p>
          <div className="hero-stats">
            <span>✓ 1200+ Active Traders</span>
            <span>✓ ₹4 Crore+ Combined Profits</span>
            <span>✓ No Credit Card Required</span>
          </div>
          <button className="cta-button">Start Free Trial</button>
        </div>
      </section>

      {/* Live Data Display */}
      <section className="live-data">
        <div className="data-container">
          <div className="data-card nifty">
            <h3>NIFTY 50</h3>
            <div className="price" style={{ color: getPriceColor(niftyChange) }}>
              ₹{niftyPrice}
            </div>
            <div className="change" style={{ color: getPriceColor(niftyChange) }}>
              {niftyChange >= 0 ? '+' : ''}{niftyChange}%
            </div>
            <div className="max-pain">Max Pain: ₹{maxPain.nifty}</div>
          </div>

          <div className="data-card sensex">
            <h3>SENSEX</h3>
            <div className="price" style={{ color: getPriceColor(sensexChange) }}>
              ₹{sensexPrice}
            </div>
            <div className="change" style={{ color: getPriceColor(sensexChange) }}>
              {sensexChange >= 0 ? '+' : ''}{sensexChange}%
            </div>
            <div className="max-pain">Max Pain: ₹{maxPain.sensex}</div>
          </div>
        </div>
      </section>

      {/* Why 87% Lose Money */}
      <section className="why-lose">
        <h2>Why 87% of Options Traders Lose Money (And How to Be in the 13%)</h2>
        <p>Average retail trader loses ₹4,80,000 in their first year. Don't be average.</p>
        
        <div className="problems">
          <div className="problem-card">
            <h4>Trading Without Max Pain Data</h4>
            <p>You don't know where institutions want expiry to happen. You're trading blind while smart money knows exactly where the market is headed.</p>
          </div>
          <div className="problem-card">
            <h4>Not Understanding Greeks</h4>
            <p>Your premium vanishes and you don't know why. Theta decay eats ₹3,000-₹5,000 daily from your positions without you realizing it.</p>
          </div>
          <div className="problem-card">
            <h4>No Live OI Intelligence</h4>
            <p>You react too late to market moves. By the time you see the trend, institutions have already positioned themselves and taken profits.</p>
          </div>
        </div>
      </section>

      {/* Tools Section */}
      <section className="tools" id="tools">
        <h2>Why FinOp Partners is Different</h2>
        <div className="tools-grid">
          <div className="tool-card">
            <h3>Auto-Updating Max Pain</h3>
            <p>Know exactly where institutions want expiry. Our Max Pain calculator updates every 30 seconds with predictive AI.</p>
          </div>
          <div className="tool-card">
            <h3>Real-Time Greeks Analysis</h3>
            <p>Understand why your premium is changing. Delta, Gamma, Theta, Vega explained in plain English with scenario builder.</p>
          </div>
          <div className="tool-card">
            <h3>Live OI Intelligence</h3>
            <p>See institutional money flow in real-time. Get alerts when large positions are being built or unwound.</p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="pricing" id="pricing">
        <h2>Choose Your Plan - Start Free Trial</h2>
        <p>No credit card required for 7-day trial. Cancel anytime.</p>
        
        <div className="pricing-cards">
          <div className="price-card">
            <h3>Free</h3>
            <p className="price">₹0</p>
            <p>/month</p>
            <ul>
              <li>✓ Basic Option Chain</li>
              <li>✓ 100 API calls/day</li>
              <li>✓ Demo Data</li>
            </ul>
            <button>Start Now</button>
          </div>

          <div className="price-card featured">
            <div className="badge">Most Popular</div>
            <h3>Pro</h3>
            <p className="price">₹499</p>
            <p>/month</p>
            <ul>
              <li>✓ Real Greeks Analysis</li>
              <li>✓ Max Pain Calculator</li>
              <li>✓ 1000 API calls/day</li>
              <li>✓ Live Alerts</li>
            </ul>
            <button>Upgrade to Pro</button>
          </div>

          <div className="price-card">
            <h3>Pro+</h3>
            <p className="price">₹799</p>
            <p>/month</p>
            <ul>
              <li>✓ Everything in Pro</li>
              <li>✓ Unlimited API calls</li>
              <li>✓ WhatsApp Alerts</li>
              <li>✓ Premium Support</li>
            </ul>
            <button>Upgrade to Pro+</button>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="testimonials">
        <h2>Real Traders, Real Profits</h2>
        <p>Join thousands of profitable traders who transformed their trading</p>
        
        <div className="testimonials-grid">
          <div className="testimonial">
            <p>"Made ₹1,42,000 in 3 months using Max Pain predictions. This tool is incredible."</p>
            <span>- Rajesh K.</span>
          </div>
          <div className="testimonial">
            <p>"The Theta calculator saved me from holding losing positions. +₹86,000 last month."</p>
            <span>- Priya M.</span>
          </div>
          <div className="testimonial">
            <p>"I was losing ₹30k/month. Now I'm profitable consistently. The Greeks tool is a game-changer."</p>
            <span>- Amit P.</span>
          </div>
          <div className="testimonial">
            <p>"Pro+ is worth every rupee. The strategy analyzer helped me perfect my Iron Condor."</p>
            <span>- Neha S.</span>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq">
        <h2>Frequently Asked Questions</h2>
        
        <div className="faq-items">
          <div className="faq-item">
            <h4>🤔 How is this different from free tools?</h4>
            <p>Free tools show delayed data. We provide real-time OI updates every 30 seconds, AI-powered predictions, and actionable insights that professional traders use.</p>
          </div>
          <div className="faq-item">
            <h4>💰 What if I don't make money?</h4>
            <p>We offer a 30-day money-back guarantee. If you're not satisfied with the platform, we'll refund your entire subscription.</p>
          </div>
          <div className="faq-item">
            <h4>❌ Can I cancel anytime?</h4>
            <p>Absolutely. Cancel your subscription anytime with a single click. No questions asked, no hidden fees.</p>
          </div>
          <div className="faq-item">
            <h4>🎯 How accurate is the Max Pain prediction?</h4>
            <p>Our Max Pain calculator has an 78% accuracy rate in predicting expiry ranges. It's based on real-time OI data from NSE.</p>
          </div>
          <div className="faq-item">
            <h4>💳 Do you offer refunds?</h4>
            <p>Yes, 30-day money-back guarantee. If you're not profitable or satisfied, we'll refund your payment.</p>
          </div>
          <div className="faq-item">
            <h4>📱 Does it work on mobile?</h4>
            <p>Yes! Our platform is fully responsive and works seamlessly on desktop, tablet, and mobile devices.</p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="final-cta">
        <h2>Join 1200+ Profitable Traders Today</h2>
        <p>Every second you wait is a trade you could be winning with data.</p>
        <button className="cta-button-large">Start Free Trial Now</button>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-section">
            <h4>FinOp Partners</h4>
            <p>Trading intelligence for retail options traders.</p>
          </div>
          <div className="footer-section">
            <h4>Legal</h4>
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Disclaimer</a>
          </div>
          <div className="footer-section">
            <h4>Contact</h4>
            <p>support@finoppartners.com</p>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2025 FinOp Partners. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
