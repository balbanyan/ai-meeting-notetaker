const puppeteer = require('puppeteer');

/**
 * Browser Pool Manager
 * 
 * Manages a pool of Puppeteer browser instances for high concurrency.
 * Architecture: Up to 40 browsers × 10 pages = 400 meeting capacity
 * 
 * Lazy Initialization Strategy:
 * - Browsers launched on-demand, not upfront
 * - Start with 0 browsers
 * - Launch browser #1 when first meeting joins
 * - Fill each browser to 10 tabs before launching next
 * - Only launch new browsers when existing ones are full
 * 
 * Benefits:
 * 1. Instant startup (no wait time)
 * 2. Lower memory when not at capacity (5 meetings = 1 browser = ~500MB)
 * 3. Fault isolation: One browser crash affects only 10 meetings (2.5%)
 * 4. Better stability: Chrome is optimized for <15 tabs per browser
 * 5. Independent GC: No global freezes during garbage collection
 * 6. Resource distribution: Each browser has its own process tree
 */
class BrowserPool {
  constructor(options = {}) {
    this.maxBrowsers = options.maxBrowsers || 40;
    this.pagesPerBrowser = options.pagesPerBrowser || 10;
    this.browsers = [];
    this.browserPageCounts = new Map();
    
    console.log(`🏊 Browser Pool Configuration:`);
    console.log(`   Max Browsers: ${this.maxBrowsers}`);
    console.log(`   Pages Per Browser: ${this.pagesPerBrowser}`);
    console.log(`   Total Capacity: ${this.maxBrowsers * this.pagesPerBrowser} concurrent meetings`);
    console.log(`   Mode: Lazy initialization (browsers launch on-demand)\n`);
  }

  /**
   * Launch a single browser with Webex-compatible settings
   */
  async launchBrowser(index, meetingUuid = null) {
    try {
      const meetingInfo = meetingUuid ? ` (Meeting UUID: ${meetingUuid})` : '';
      console.log(`🚀 Launching browser ${index + 1} on-demand...${meetingInfo}`);
      
      const browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--allow-running-insecure-content',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--enable-usermedia-screen-capturing',
          '--allow-http-screen-capture',
          '--enable-features=WebRTC',
          '--disable-features=VizDisplayCompositor',
          '--allow-cross-origin-auth-prompt',
          '--autoplay-policy=no-user-gesture-required', // CRITICAL: Prevents video from being paused
          '--window-size=1280,720',
          // Performance optimizations (safe ones only - NO --disable-gpu!)
          '--disable-extensions',
          '--disable-plugins'
        ],
        defaultViewport: { width: 1280, height: 720 }
      });
      
      this.browsers.push(browser);
      this.browserPageCounts.set(browser, 0);
      
      console.log(`✅ Browser ${index + 1} launched (${this.browsers.length}/${this.maxBrowsers} browsers active)${meetingInfo}\n`);
      
      return browser;
    } catch (error) {
      console.error(`❌ Failed to launch browser ${index}:`, error.message);
      throw error;
    }
  }

  /**
   * Get an available browser for a new meeting
   * Lazily launches browsers on-demand as needed
   * 
   * Strategy:
   * 1. Check existing browsers for available slots
   * 2. If all full, launch a new browser (if under maxBrowsers)
   * 3. If at maxBrowsers and all full, throw error
   * 
   * @param {string} meetingUuid - Meeting UUID for logging
   * @returns {Object} { browser, browserIndex } or throws if at capacity
   */
  async getAvailableBrowser(meetingUuid = null) {
    const meetingInfo = meetingUuid ? ` (Meeting UUID: ${meetingUuid})` : '';
    
    // First, try to find an existing browser with available capacity
    for (let i = 0; i < this.browsers.length; i++) {
      const browser = this.browsers[i];
      const pageCount = this.browserPageCounts.get(browser);
      
      if (pageCount < this.pagesPerBrowser) {
        // Found available slot in existing browser
        this.browserPageCounts.set(browser, pageCount + 1);
        
        console.log(`📎 Allocated browser ${i} (${pageCount + 1}/${this.pagesPerBrowser} pages used)${meetingInfo}`);
        
        return { browser, browserIndex: i };
      }
    }
    
    // No existing browser has space - need to launch a new one
    if (this.browsers.length < this.maxBrowsers) {
      const newBrowser = await this.launchBrowser(this.browsers.length, meetingUuid);
      this.browserPageCounts.set(newBrowser, 1); // Immediately allocate to the new meeting
      
      const browserIndex = this.browsers.length - 1;
      console.log(`📎 Allocated new browser ${browserIndex} (1/${this.pagesPerBrowser} pages used)${meetingInfo}`);
      
      return { browser: newBrowser, browserIndex };
    }
    
    // All browsers launched and all at capacity
    const totalUsage = Array.from(this.browserPageCounts.values()).reduce((a, b) => a + b, 0);
    throw new Error(
      `All browsers at capacity! ` +
      `(${totalUsage}/${this.maxBrowsers * this.pagesPerBrowser} meetings active)`
    );
  }

  /**
   * Release a browser slot when a meeting ends
   * 
   * @param {Object} browser - The browser instance to release
   * @param {string} meetingUuid - Meeting UUID for logging
   */
  releaseBrowser(browser, meetingUuid = null) {
    const pageCount = this.browserPageCounts.get(browser);
    if (pageCount > 0) {
      this.browserPageCounts.set(browser, pageCount - 1);
      const browserIndex = this.browsers.indexOf(browser);
      const meetingInfo = meetingUuid ? ` (Meeting UUID: ${meetingUuid})` : '';
      console.log(`🔓 Released browser ${browserIndex} slot (${pageCount - 1}/${this.pagesPerBrowser} pages remaining)${meetingInfo}`);
    }
  }

  /**
   * Get pool statistics for monitoring
   * 
   * @returns {Object} Pool statistics
   */
  getStats() {
    const stats = {
      maxBrowsers: this.maxBrowsers,
      launchedBrowsers: this.browsers.length,
      capacityPerBrowser: this.pagesPerBrowser,
      totalCapacity: this.maxBrowsers * this.pagesPerBrowser,
      currentCapacity: this.browsers.length * this.pagesPerBrowser,
      browsers: [],
      totalUsage: 0,
      utilizationPercent: 0
    };
    
    this.browsers.forEach((browser, idx) => {
      const pageCount = this.browserPageCounts.get(browser);
      stats.totalUsage += pageCount;
      
      stats.browsers.push({
        index: idx,
        pagesInUse: pageCount,
        capacity: this.pagesPerBrowser,
        utilizationPercent: ((pageCount / this.pagesPerBrowser) * 100).toFixed(1)
      });
    });
    
    if (stats.currentCapacity > 0) {
      stats.utilizationPercent = ((stats.totalUsage / stats.currentCapacity) * 100).toFixed(1);
    }
    
    return stats;
  }

  /**
   * Close all browsers in the pool
   * Called during shutdown
   */
  async close() {
    if (this.browsers.length === 0) {
      console.log('✅ No browsers to close (pool was empty)\n');
      return;
    }
    
    console.log(`\n🛑 Closing ${this.browsers.length} browser(s)...`);
    
    for (let i = 0; i < this.browsers.length; i++) {
      try {
        await this.browsers[i].close();
        console.log(`   ✅ Closed browser ${i + 1}/${this.browsers.length}`);
      } catch (error) {
        console.error(`   ❌ Error closing browser ${i}:`, error.message);
      }
    }
    
    this.browsers = [];
    this.browserPageCounts.clear();
    
    console.log('✅ Browser pool closed\n');
  }
}

module.exports = { BrowserPool };
