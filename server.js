const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy Pool Initialization
let proxies = [];

// 1. Try reading from Hugging Face Secrets (Environment Variables)
if (process.env.PROXY_LIST) {
  proxies = process.env.PROXY_LIST.split(/[\n,]+/).map(p => p.trim()).filter(Boolean);
} 
// 2. Fallback to local proxies.txt for local development
else {
  try {
    const fileData = fs.readFileSync(path.join(__dirname, 'proxies.txt'), 'utf8');
    const loadedProxies = fileData.split('\n')
      .map(p => p.trim())
      .filter(p => p && !p.startsWith('#'));
    if (loadedProxies.length > 0) {
      proxies = loadedProxies;
    }
  } catch (e) {
    console.log("No proxies.txt found or failed to read.");
  }
}

if (proxies.length === 0) {
  proxies = [null]; // Fallback to direct connection if absolutely no proxies exist
}

// Browser Pool: proxyUrl -> { browser, page, isReady, isBusy, requestCount }
const browserPool = new Map();
let currentProxyIndex = 0;

async function initBrowserForProxy(proxyUrl) {
    if (browserPool.has(proxyUrl)) {
        try { await browserPool.get(proxyUrl).browser.close(); } catch(e){}
        browserPool.delete(proxyUrl);
    }
    
    console.log(`[Browser Pool] Booting persistent browser for proxy: ${proxyUrl || 'LOCAL'}`);
    
    let launchOptions = {
        headless: 'new',
        args: []
    };

    if (proxyUrl && proxyUrl !== 'null' && proxyUrl !== 'undefined') {
        const parts = proxyUrl.split(':');
        if (parts.length === 4) {
            const [ip, port] = parts;
            launchOptions.args.push(`--proxy-server=${ip}:${port}`);
        } else {
            launchOptions.args.push(`--proxy-server=${proxyUrl}`);
        }
    }

    let browser;
    try {
        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        
        if (proxyUrl && proxyUrl !== 'null' && proxyUrl !== 'undefined') {
            const parts = proxyUrl.split(':');
            if (parts.length === 4) {
                const [ip, port, user, pass] = parts;
                await page.authenticate({ username: user, password: pass });
            }
        }
        
        // Pre-warm the Akamai connection. If this fails, the proxy is dead.
        await page.goto('https://tools.usps.com/go/TrackConfirmAction', { waitUntil: 'domcontentloaded', timeout: 30000 });

        browserPool.set(proxyUrl, {
            browser,
            page,
            isReady: true,
            isBusy: false,
            requestCount: 0
        });
        console.log(`[Browser Pool] Successfully warmed up proxy: ${proxyUrl || 'LOCAL'}`);
        return true;
    } catch(error) {
        console.log(`[Browser Pool] Failed to boot or warm up proxy: ${proxyUrl || 'LOCAL'} - ${error.message}`);
        // Ensure we close the browser if it failed during goto
        try { if (browser) await browser.close(); } catch(e){}
        return false;
    }
}

async function bootAllBrowsers() {
    console.log('[Browser Pool] Starting global boot sequence...');
    let goodCount = 0;
    for (const proxy of proxies) {
        if (goodCount >= 5) break;
        const success = await initBrowserForProxy(proxy);
        if (success) goodCount++;
    }
    console.log(`[Browser Pool] Boot sequence complete. ${goodCount} browsers active.`);
}

function getNextProxy() {
  const readyProxies = Array.from(browserPool.keys()).filter(url => {
      const p = browserPool.get(url);
      return p.isReady && !p.isBusy;
  });
  
  if (readyProxies.length === 0) return null;
  const proxy = readyProxies[currentProxyIndex % readyProxies.length];
  currentProxyIndex++;
  
  // Lock it
  browserPool.get(proxy).isBusy = true;
  return proxy;
}

function releaseProxy(proxyUrl, markDead = false) {
    const p = browserPool.get(proxyUrl);
    if (p) {
        p.isBusy = false;
        if (markDead) p.isReady = false;
    }
}

function normalize17Track(rawPackage) {
  const stateCode = rawPackage.e;
  const carrierName = (rawPackage.track && rawPackage.track.ln1) ? rawPackage.track.ln1 : 'Auto-detected';
  
  let events = [];
  if (rawPackage.track) {
    const z1 = rawPackage.track.z1 || [];
    const z2 = rawPackage.track.z2 || [];
    events = [...z1, ...z2].map(e => ({
      time: e.a || '',
      location: e.c || e.b || '',
      desc: e.z || e.d || 'Update'
    })).sort((a, b) => new Date(b.time) - new Date(a.time));
  }

  return {
    trackingNumber: rawPackage.no,
    carrier: carrierName,
    status: stateCode,
    events: events,
    source: '17track'
  };
}

async function scrapeUSPS(trackingNumber, isRace = false) {
  let proxy = getNextProxy();
  if (!proxy) {
      if (isRace) throw new Error("No working proxies available for race");
      return { error: 'No working proxies available or all are busy. Please wait.' };
  }
  
  console.log(`Starting USPS fetcher (Persistent): ${trackingNumber} (Proxy: ${proxy})`);
  const poolEntry = browserPool.get(proxy);
  const page = poolEntry.page;
  
  try {
      await page.goto(`https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`, {
          waitUntil: 'domcontentloaded',
          timeout: 15000
      });

      const result = await page.evaluate(async () => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          let attempts = 0;
          
          while (attempts < 30) { // 6s timeout instead of 30s. Fail fast if proxy is stuck on Akamai challenge.
              if (document.body && document.body.innerText.includes('Status Not Available')) {
                  return { state: 'Not Found', events: [{ time: '', location: '', details: 'Tracking number not found or not yet in system' }] };
              }
              const errorEl = document.querySelector('.track-status-error');
              if (errorEl && errorEl.innerText.includes('Label Created, not yet in system')) {
                  return { state: 'Not Found', events: [{ time: '', location: '', details: 'Label Created, not yet in system' }] };
              }

              const statusEl = document.querySelector('.tb-status-detail');
              if (statusEl) {
                  const state = statusEl.innerText.trim();
                  const events = [];
                  const historyItems = document.querySelectorAll('.tb-step');
                  
                  historyItems.forEach(item => {
                      const dateEl = item.querySelector('.tb-date');
                      const timeEl = item.querySelector('.tb-time');
                      const detailEl = item.querySelector('.tb-status-detail') || item.querySelector('.tb-status');
                      const locationEl = item.querySelector('.tb-location');
                      if (dateEl && detailEl) {
                          let timeStr = dateEl.innerText.trim();
                          if (timeEl) timeStr += ' ' + timeEl.innerText.trim();
                          events.push({ time: timeStr, location: locationEl ? locationEl.innerText.trim() : '', details: detailEl.innerText.trim() });
                      }
                  });
                  return { state, events };
              }
              attempts++;
              await sleep(200);
          }
          throw new Error("Waiting failed: 6000ms exceeded");
      });

      // Format result
      let mappedStatus = 10;
      const lowerStatus = (result.state || '').toLowerCase();
      if (lowerStatus.includes('delivered')) mappedStatus = 40;
      else if (lowerStatus.includes('out for delivery')) mappedStatus = 20;

      const formattedEvents = (result.events || []).map(event => ({
        time: event.time || '',
        location: event.location || '',
        desc: event.details || 'Update'
      }));

      // Release proxy and check for restart
      poolEntry.requestCount++;
      if (poolEntry.requestCount > 50) {
          console.log(`[Browser Pool] Proxy ${proxy} reached 50 requests. Restarting to clear RAM...`);
          releaseProxy(proxy, true);
          initBrowserForProxy(proxy); // async background restart
      } else {
          releaseProxy(proxy);
      }

      return {
        trackingNumber: trackingNumber,
        carrier: 'USPS',
        status: mappedStatus,
        events: formattedEvents,
        source: 'USPS Web API Direct (Sub-5s)'
      };

  } catch (error) {
      console.error(`USPS API Error: ${error.message}`);
      releaseProxy(proxy, true);
      // Restart broken browser in background
      initBrowserForProxy(proxy);
      if (isRace) throw error;
      return await retryFetchUSPS(trackingNumber);
  }
}

async function retryFetchUSPS(trackingNumber) {
    const nextProxy = getNextProxy();
    if (!nextProxy) {
        return { 
            trackingNumber: trackingNumber,
            carrier: 'USPS',
            status: 30,
            events: [{ time: new Date().toLocaleString(), desc: 'All proxies failed or busy', location: '' }],
            source: 'USPS Direct (Error)'
        };
    }
    
    console.log(`Retrying USPS fetcher: ${trackingNumber} with fallback proxy...`);
    const poolEntry = browserPool.get(nextProxy);
    const page = poolEntry.page;
    
    try {
        await page.goto(`https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const result = await page.evaluate(async () => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            let attempts = 0;
            while (attempts < 30) {
                if (document.body && document.body.innerText.includes('Status Not Available')) return { state: 'Not Found', events: [{ time: '', location: '', details: 'Not found' }] };
                
                const statusEl = document.querySelector('.tb-status-detail');
                if (statusEl) {
                    const state = statusEl.innerText.trim();
                    const events = [];
                    const historyItems = document.querySelectorAll('.tb-step');
                    historyItems.forEach(item => {
                        const dateEl = item.querySelector('.tb-date');
                        const timeEl = item.querySelector('.tb-time');
                        const detailEl = item.querySelector('.tb-status-detail') || item.querySelector('.tb-status');
                        const locationEl = item.querySelector('.tb-location');
                        if (dateEl && detailEl) {
                            let timeStr = dateEl.innerText.trim();
                            if (timeEl) timeStr += ' ' + timeEl.innerText.trim();
                            events.push({ time: timeStr, location: locationEl ? locationEl.innerText.trim() : '', details: detailEl.innerText.trim() });
                        }
                    });
                    return { state, events };
                }
                attempts++;
                await sleep(200);
            }
            throw new Error("Waiting failed: 6000ms exceeded");
        });

        let mappedStatus = 10;
        if ((result.state || '').toLowerCase().includes('delivered')) mappedStatus = 40;
        
        const formattedEvents = (result.events || []).map(event => ({
            time: event.time || '',
            location: event.location || '',
            desc: event.details || 'Update'
        }));

        poolEntry.requestCount++;
        releaseProxy(nextProxy);
        
        return {
            trackingNumber: trackingNumber,
            carrier: 'USPS',
            status: mappedStatus,
            events: formattedEvents,
            source: 'USPS Web API Direct (Retry Sub-5s)'
        };
    } catch (error) {
        releaseProxy(nextProxy, true);
        initBrowserForProxy(nextProxy);
        return { 
            trackingNumber: trackingNumber,
            carrier: 'USPS',
            status: 30,
            events: [{ time: new Date().toLocaleString(), desc: 'Retry failed: ' + error.message, location: '' }],
            source: 'USPS Direct (Error)'
        };
    }
}

async function scrape17Track(trackingNumbers) {
  const payload = trackingNumbers.map(num => ({ number: num.trim(), finalCarrier: 0, carrier: 0 }));
  const response = await axios.post('https://www.17track.net/restapi/track', payload, {
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.17track.net/en', 'Origin': 'https://www.17track.net' },
    timeout: 10000
  });
  if (!response.data || !response.data.dat) throw new Error('Invalid 17track response');
  return response.data.dat.map(pkg => normalize17Track(pkg));
}

async function trackPackage(trackingNumber) {
  const isUSPS = /^(92|94|93|95)\d{20}$/.test(trackingNumber) || /^E\w{8}US$/.test(trackingNumber) || /^\d{20,22}$/.test(trackingNumber);

  let uspsErrorResult = null;
  if (isUSPS) {
    try {
      const readyProxies = Array.from(browserPool.values()).filter(p => p.isReady && !p.isBusy).length;
      let uspsResult;
      
      if (readyProxies >= 2) {
          console.log(`[RACE MODE] Launching 2 concurrent scrapers for ${trackingNumber}`);
          try {
              uspsResult = await Promise.any([
                  scrapeUSPS(trackingNumber, true),
                  scrapeUSPS(trackingNumber, true)
              ]);
          } catch (aggregateError) {
              console.log(`[RACE MODE] Both candidates failed for ${trackingNumber}, falling back to single retry...`);
              uspsResult = await retryFetchUSPS(trackingNumber);
          }
      } else {
          uspsResult = await scrapeUSPS(trackingNumber);
      }
      
      if (uspsResult && uspsResult.status !== 30 && uspsResult.status !== 0) return uspsResult;
      uspsErrorResult = uspsResult;
    } catch(e) { console.log(`USPS Direct failed: ${e.message}`); }
  }

  try {
    const track17Result = await scrape17Track([trackingNumber]);
    const pkg = track17Result[0];
    if (pkg.status !== 0 || pkg.events.length > 0) return pkg;
    throw new Error('Not found in 17track');
  } catch (e) {
    if (isUSPS && uspsErrorResult) return uspsErrorResult;
    return { trackingNumber: trackingNumber, carrier: isUSPS ? 'USPS' : 'Unknown', status: 0, events: [], source: 'Exhausted all fallbacks' };
  }
}

class AsyncQueue {
  constructor(concurrency = 1) {
    this.queue = [];
    this.activeCount = 0;
    this.concurrency = concurrency;
  }
  async add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try { resolve(await task()); }
        catch (e) { reject(e); }
      });
      this.process();
    });
  }
  async process() {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      this.activeCount++;
      const task = this.queue.shift();
      task().finally(() => {
        this.activeCount--;
        this.process();
      });
    }
  }
}

// Concurrency is naturally limited by the number of ready proxies. 
// With Request Hedging (2 proxies per request) and 5 proxies total, max safe concurrency is 2.
const trackingQueue = new AsyncQueue(2);

app.post('/api/track', async (req, res) => {
  const { trackingNumbers } = req.body;
  if (!trackingNumbers || !Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
    return res.status(400).json({ error: 'Invalid tracking numbers format.' });
  }

  try {
    const promises = trackingNumbers.map(num => {
      if (typeof num !== 'string' || !num.trim()) {
          return Promise.resolve({ error: 'Invalid tracking number format' });
      }
      return trackingQueue.add(() => trackPackage(num.trim()));
    });
    
    const results = await Promise.all(promises);
    return res.json({ success: true, data: results });
  } catch (error) {
    console.error('Engine error:', error);
    return res.status(500).json({ error: 'Tracking engine failed.', message: error.message });
  }
});

app.get('*', (req, res) => {
  res.send(`
    <html>
      <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5;">
        <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
          <h2 style="color: #3b82f6;">🚀 Máy chủ Tracking Đang Hoạt Động!</h2>
          <p style="color: #6b7280;">Hệ thống nền đã sẵn sàng nhận lệnh 24/7.</p>
          <p style="color: #6b7280;">(Vui lòng mở file <b>Shopify_Tracking_Page.html</b> trên máy tính để tra cứu thử)</p>
        </div>
      </body>
    </html>
  `);
});

app.listen(PORT, async () => {
  console.log(`Sub-5s Persistent Tracking Engine running at http://localhost:${PORT}`);
  await bootAllBrowsers();
});
