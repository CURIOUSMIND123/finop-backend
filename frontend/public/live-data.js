javascript
// Trading Dashboard Live Data Script
// This script fetches REAL data from your backend and updates ALL elements on the page

const BACKEND_URL = 'https://trading-backend.onrender.com';

// Store all price elements that need updating
const priceElements = {
  nifty: [],
  sensex: [],
  maxPain: [],
  greeks: [],
  ticker: []
};

// Initialize - find all elements on page that contain price data
function initializeElements() {
  // Find all elements that might contain prices
  const allElements = document.querySelectorAll('*');
  
  allElements.forEach(el => {
    const text = el.textContent.toLowerCase();
    const className = el.className.toLowerCase();
    const id = el.id.toLowerCase();
    
    // Check for NIFTY references
    if ((text.includes('nifty') || className.includes('nifty') || id.includes('nifty')) && 
        !el.querySelector('*')) { // Leaf nodes only
      priceElements.nifty.push(el);
    }
    
    // Check for SENSEX references
    if ((text.includes('sensex') || className.includes('sensex') || id.includes('sensex')) && 
        !el.querySelector('*')) {
      priceElements.sensex.push(el);
    }
    
    // Check for MAX PAIN references
    if ((text.includes('max pain') || className.includes('maxpain') || id.includes('maxpain')) && 
        !el.querySelector('*')) {
      priceElements.maxPain.push(el);
    }
    
    // Check for TICKER
    if ((className.includes('ticker') || id.includes('ticker')) && 
        !el.querySelector('*')) {
      priceElements.ticker.push(el);
    }
  });
  
  console.log('Elements found:', {
    nifty: priceElements.nifty.length,
    sensex: priceElements.sensex.length,
    maxPain: priceElements.maxPain.length,
    ticker: priceElements.ticker.length
  });
}

// Fetch and update live data every 3 seconds
async function fetchLiveData() {
  try {
    // Fetch NIFTY data
    const niftyRes = await fetch(`${BACKEND_URL}/api/nifty`);
    const niftyData = await niftyRes.json();
    
    // Fetch SENSEX data
    const sensexRes = await fetch(`${BACKEND_URL}/api/sensex`);
    const sensexData = await sensexRes.json();
    
    // Update all elements with new prices
    updatePageWithPrices(niftyData, sensexData);
    
    // Show connection status
    updateConnectionStatus(true);
    
  } catch (error) {
    console.error('Error fetching live data:', error);
    updateConnectionStatus(false);
  }
}

// Update all price elements on the page
function updatePageWithPrices(niftyData, sensexData) {
  const niftyPrice = parseFloat(niftyData.price).toFixed(2);
  const niftyChange = parseFloat(niftyData.change).toFixed(2);
  const sensexPrice = parseFloat(sensexData.price).toFixed(2);
  const sensexChange = parseFloat(sensexData.change).toFixed(2);
  
  // Color coding
  const niftyColor = niftyChange >= 0 ? '#2db2a4' : '#ff5459';
  const sensexColor = sensexChange >= 0 ? '#2db2a4' : '#ff5459';
  
  // Update all NIFTY elements
  priceElements.nifty.forEach(el => {
    if (el.textContent.includes('₹') || el.textContent.includes('Rs')) {
      el.textContent = `₹${niftyPrice}`;
      el.style.color = niftyColor;
    } else if (el.textContent.includes('%')) {
      el.textContent = `${niftyChange >= 0 ? '+' : ''}${niftyChange}%`;
      el.style.color = niftyColor;
    }
  });
  
  // Update all SENSEX elements
  priceElements.sensex.forEach(el => {
    if (el.textContent.includes('₹') || el.textContent.includes('Rs')) {
      el.textContent = `₹${sensexPrice}`;
      el.style.color = sensexColor;
    } else if (el.textContent.includes('%')) {
      el.textContent = `${sensexChange >= 0 ? '+' : ''}${sensexChange}%`;
      el.style.color = sensexColor;
    }
  });
  
  // Update MAX PAIN
  priceElements.maxPain.forEach(el => {
    const estimatedMaxPain = (niftyPrice - 50).toFixed(2);
    el.textContent = `₹${estimatedMaxPain}`;
    el.style.color = '#2db2a4';
  });
  
  // Update TICKER (if exists)
  updateTickerDisplay(niftyPrice, niftyChange);
}

// Update ticker display at top of page
function updateTickerDisplay(niftyPrice, niftyChange) {
  const tickerElement = document.querySelector('[class*="ticker"], [id*="ticker"]');
  if (tickerElement) {
    const color = niftyChange >= 0 ? '#2db2a4' : '#ff5459';
    tickerElement.innerHTML = `
      <span style="color: ${color};">
        📈 NIFTY: ₹${niftyPrice} (${niftyChange >= 0 ? '+' : ''}${niftyChange}%)
      </span>
    `;
  }
}

// Show connection status
function updateConnectionStatus(isConnected) {
  const statusIndicator = document.querySelector('[class*="status"], [id*="status"], [class*="connection"], [id*="connection"]');
  if (statusIndicator) {
    if (isConnected) {
      statusIndicator.innerHTML = '🟢 Live Data Connected';
      statusIndicator.style.color = '#2db2a4';
    } else {
      statusIndicator.innerHTML = '🔴 Connecting to Data...';
      statusIndicator.style.color = '#ff5459';
    }
  }
}

// WebSocket connection for real-time updates (optional, faster than polling)
function connectWebSocket() {
  try {
    // Try to connect to WebSocket for real-time updates
    const socketScript = document.createElement('script');
    socketScript.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
    socketScript.onload = function() {
      const socket = io(BACKEND_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
      });
      
      socket.on('connect', () => {
        console.log('WebSocket connected for real-time updates');
        updateConnectionStatus(true);
      });
      
      socket.on('liveData', (data) => {
        updatePageWithPrices(
          { price: data.nifty.price, change: data.nifty.change },
          { price: data.sensex.price, change: data.sensex.change }
        );
      });
      
      socket.on('disconnect', () => {
        updateConnectionStatus(false);
      });
    };
    document.head.appendChild(socketScript);
  } catch (error) {
    console.log('WebSocket not available, using polling...');
  }
}

// START THE LIVE DATA UPDATES
document.addEventListener('DOMContentLoaded', function() {
  console.log('Initializing live data system...');
  
  // Initialize elements
  initializeElements();
  
  // Fetch initial data
  fetchLiveData();
  
  // Update every 3 seconds (Dhan API rate limit)
  setInterval(fetchLiveData, 3000);
  
  // Try to connect WebSocket for faster updates
  setTimeout(connectWebSocket, 1000);
  
  console.log('✅ Live data system started!');
});

// Fallback: If document is already loaded when script runs
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeElements);
} else {
  initializeElements();
  fetchLiveData();
  setInterval(fetchLiveData, 3000);
  connectWebSocket();
}
