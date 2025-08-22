const puppeteer = require('puppeteer');
const { config, validateConfig } = require('../shared/config');
const { PuppeteerWebexClient } = require('./webex-client');

/**
 * Headless Runner Manager
 * Manages Puppeteer browser instances and meeting sessions
 */
class HeadlessRunner {
  constructor() {
    this.browser = null;
    this.activeMeetings = new Map();
    this.isRunning = false;
  }

  /**
   * Start the headless runner
   */
  async start() {
    try {
      console.log('🚀 Starting Headless Runner...');
      
      // Validate configuration
      validateConfig();
      console.log('✅ Configuration validated');
      
      // Launch Puppeteer browser with Webex-compatible settings
      this.browser = await puppeteer.launch({
        headless: 'new', // Use new headless mode
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security', // For Webex SDK
          '--allow-running-insecure-content',
          '--use-fake-ui-for-media-stream', // Auto-grant media permissions
          '--allow-running-insecure-content',
          '--enable-features=WebRTC',
          '--disable-web-security',
          '--allow-cross-origin-auth-prompt',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-features=VizDisplayCompositor' // For better audio support
        ],
        defaultViewport: {
          width: 1280,
          height: 720
        }
      });

      console.log('✅ Puppeteer browser launched successfully');
      
      // Start API server
      await this.startAPIServer();
      
      this.isRunning = true;
      console.log('🎉 Headless Runner is ready!');
      console.log('📡 API available at http://localhost:3001');
      
      // Keep the process running
      await this.waitForever();
      
    } catch (error) {
      console.error('❌ Failed to start Headless Runner:', error);
      throw error;
    }
  }

  /**
   * Start HTTP API server for headless control
   */
  async startAPIServer() {
    const express = require('express');
    const cors = require('cors');
    const app = express();
    
    app.use(cors());
    app.use(express.json());
    
    // Health check
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        mode: 'headless',
        activeMeetings: this.activeMeetings.size,
        browserConnected: !!this.browser && this.browser.isConnected()
      });
    });
    
    // Join meeting endpoint - now with real Webex functionality
    app.post('/join', async (req, res) => {
      try {
        const { meetingUrl, hostEmail } = req.body;
        
        if (!meetingUrl) {
          return res.status(400).json({ 
            success: false, 
            error: 'meetingUrl is required' 
          });
        }
        
        console.log(`📞 Join meeting request received`);
        
        // Create new page for this meeting
        const page = await this.browser.newPage();
        
        // Grant microphone permissions for known Webex domains
        const context = this.browser.defaultBrowserContext();
        try {
          await context.overridePermissions('https://unpkg.com', ['microphone', 'camera']);
          await context.overridePermissions('https://webexapis.com', ['microphone', 'camera']);
          await context.overridePermissions('https://pif.webex.com', ['microphone', 'camera']);
          console.log('🎤 Microphone permissions granted for Webex domains');
        } catch (permError) {
          console.log('⚠️ Permission grant failed (will rely on browser flags):', permError.message);
        }
        
        // Create Webex client for this page
        const webexClient = new PuppeteerWebexClient(page);
        
        // Join the meeting
        const result = await webexClient.joinMeeting(meetingUrl);
        
        // Store meeting session
        const meetingId = result.meetingId;
        this.activeMeetings.set(meetingId, { 
          page, 
          webexClient, 
          meetingUrl,
          startTime: new Date().toISOString()
        });
        
        console.log(`✅ Meeting joined successfully: ${meetingId}`);
        
        res.json({ 
          success: true, 
          meetingId,
          hostEmail: result.hostEmail,
          message: 'Meeting joined successfully'
        });
        
      } catch (error) {
        console.error('❌ Join meeting error:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });
    
    // Leave meeting endpoint
    app.post('/leave', async (req, res) => {
      try {
        const { meetingId } = req.body;
        
        if (!meetingId) {
          return res.status(400).json({ 
            success: false, 
            error: 'meetingId is required' 
          });
        }
        
        console.log(`📞 Leave meeting request: ${meetingId}`);
        
        if (this.activeMeetings.has(meetingId)) {
          const { page, webexClient } = this.activeMeetings.get(meetingId);
          
          // Leave meeting gracefully
          await webexClient.leaveMeeting();
          await page.close();
          this.activeMeetings.delete(meetingId);
          
          console.log(`✅ Meeting left successfully: ${meetingId}`);
          
          res.json({ 
            success: true, 
            message: 'Meeting left successfully' 
          });
        } else {
          res.status(404).json({ 
            success: false, 
            error: 'Meeting not found' 
          });
        }
        
      } catch (error) {
        console.error('❌ Leave meeting error:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });
    
    // Get meeting status
    app.get('/meetings/:meetingId/status', (req, res) => {
      const { meetingId } = req.params;
      
      if (this.activeMeetings.has(meetingId)) {
        const { webexClient, meetingUrl, startTime } = this.activeMeetings.get(meetingId);
        const status = webexClient.getStatus();
        
        res.json({
          success: true,
          meetingId,
          meetingUrl,
          startTime,
          ...status
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Meeting not found'
        });
      }
    });
    
    // List all meetings
    app.get('/meetings', (req, res) => {
      const meetings = Array.from(this.activeMeetings.entries()).map(([meetingId, data]) => ({
        meetingId,
        meetingUrl: data.meetingUrl,
        startTime: data.startTime,
        status: data.webexClient.getStatus()
      }));
      
      res.json({
        success: true,
        activeMeetings: meetings.length,
        meetings
      });
    });
    
    // Start server
    const server = app.listen(3001, () => {
      console.log('🌐 API server started on port 3001');
      console.log('📋 Available endpoints:');
      console.log('   GET  /health');
      console.log('   POST /join');
      console.log('   POST /leave');
      console.log('   GET  /meetings');
      console.log('   GET  /meetings/:id/status');
    });
    
    this.server = server;
  }

  /**
   * Stop the headless runner
   */
  async stop() {
    try {
      console.log('🛑 Stopping Headless Runner...');
      
      // Close all active meetings
      for (const [meetingId, { page }] of this.activeMeetings) {
        console.log(`📞 Closing meeting: ${meetingId}`);
        await page.close();
      }
      this.activeMeetings.clear();
      
      // Close browser
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      
      // Close server
      if (this.server) {
        this.server.close();
      }
      
      this.isRunning = false;
      console.log('✅ Headless Runner stopped');
      
    } catch (error) {
      console.error('❌ Error stopping Headless Runner:', error);
    }
  }

  /**
   * Keep the process running
   */
  async waitForever() {
    return new Promise((resolve) => {
      // Keep alive, will be resolved by signal handlers
      const keepAlive = setInterval(() => {
        if (!this.isRunning) {
          clearInterval(keepAlive);
          resolve();
        }
      }, 1000);
    });
  }
}

module.exports = { HeadlessRunner };
