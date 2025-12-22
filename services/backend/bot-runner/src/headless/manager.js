const puppeteer = require('puppeteer');
const { config, validateConfig } = require('../lib/config');
const { MultistreamWebexClient } = require('./webex-client-multistream');
const { BrowserPool } = require('./browser-pool');

/**
 * Headless Runner Manager
 * Manages browser pool and meeting sessions for high concurrency
 * Architecture: 40 browsers × 10 pages = 400 meeting capacity
 */
class HeadlessRunner {
  constructor() {
    this.browserPool = null;
    this.activeMeetings = new Map();
    this.isRunning = false;
  }

  /**
   * Start the headless runner with browser pool
   */
  async start() {
    try {
      console.log('🚀 Starting Headless Runner...\n');
      
      // Validate configuration
      validateConfig();
      console.log('✅ Configuration validated\n');
      
      // Create browser pool (browsers will launch on-demand)
      this.browserPool = new BrowserPool({
        maxBrowsers: 40,
        pagesPerBrowser: 10
      });
      
      // Start API server
      await this.startAPIServer();
      
      this.isRunning = true;
      console.log('🎉 Headless Runner is ready!');
      console.log('📡 API available at http://localhost:3001');
      console.log('💡 Browsers will launch on-demand as meetings join\n');
      
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
      const poolStats = this.browserPool ? this.browserPool.getStats() : null;
      
      res.json({ 
        status: 'ok', 
        mode: 'headless-pool',
        activeMeetings: this.activeMeetings.size,
        pool: poolStats ? {
          totalCapacity: poolStats.totalCapacity,
          currentUsage: poolStats.totalUsage,
          utilizationPercent: poolStats.utilizationPercent,
          availableSlots: poolStats.totalCapacity - poolStats.totalUsage
        } : null
      });
    });
    
    // Pool stats endpoint
    app.get('/pool/stats', (req, res) => {
      if (!this.browserPool) {
        return res.status(503).json({
          success: false,
          error: 'Browser pool not initialized'
        });
      }
      
      const stats = this.browserPool.getStats();
      res.json({
        success: true,
        ...stats
      });
    });
    
    // Join meeting endpoint
    app.post('/join', async (req, res) => {
      try {
        const { meetingUrl, meetingUuid, hostEmail, maxDurationMinutes } = req.body;
        
        if (!meetingUrl) {
          return res.status(400).json({ 
            success: false, 
            error: 'meetingUrl is required' 
          });
        }
        
        const uuidInfo = meetingUuid ? ` (Meeting UUID: ${meetingUuid})` : '';
        console.log(`📞 Join meeting request received${uuidInfo}`);
        if (meetingUuid) {
          console.log(`📋 Embedded app workflow - Meeting UUID: ${meetingUuid}`);
        }
        if (maxDurationMinutes) {
          console.log(`⏱️ Max duration: ${maxDurationMinutes} minutes`);
        }
        
        // Get available browser from pool
        let browserInfo;
        try {
          browserInfo = await this.browserPool.getAvailableBrowser(meetingUuid);
        } catch (poolError) {
          console.error(`❌ ${poolError.message}`);
          return res.status(503).json({
            success: false,
            error: 'All browsers at capacity',
            message: poolError.message
          });
        }
        
        // Create new page from pooled browser
        const page = await browserInfo.browser.newPage();
        
        // Set page timeout to allow for longer initialization
        page.setDefaultTimeout(120000); // 2 minutes for all operations
        
        // Grant microphone permissions for known Webex domains
        const context = browserInfo.browser.defaultBrowserContext();
        try {
          await context.overridePermissions('https://unpkg.com', ['microphone', 'camera']);
          await context.overridePermissions('https://webexapis.com', ['microphone', 'camera']);
          await context.overridePermissions('https://pif.webex.com', ['microphone', 'camera']);
          console.log('🎤 Microphone permissions granted for Webex domains');
        } catch (permError) {
          console.log('⚠️ Permission grant failed (will rely on browser flags):', permError.message);
        }
        
        // Create Webex client for this page
        const webexClient = new MultistreamWebexClient(page);
        
        // Generate temporary meeting ID for tracking
        const tempMeetingId = meetingUuid || `meeting_${Date.now()}`;
        
        // Join the meeting and wait for result before responding
        try {
          const result = await webexClient.joinMeeting(meetingUrl, meetingUuid, hostEmail, maxDurationMinutes);
          
          // Check if join was actually successful
          if (result && result.success !== false) {
            // Store meeting session with browser info
            const meetingId = result.meetingId || tempMeetingId;
            this.activeMeetings.set(meetingId, { 
              page, 
              webexClient, 
              browser: browserInfo.browser,
              browserIndex: browserInfo.browserIndex,
              meetingUrl,
              startTime: new Date().toISOString(),
              inLobby: result.inLobby || false
            });
            
            // Log appropriate message based on lobby status
            if (result.inLobby) {
              console.log(`🚪 Bot waiting in lobby - ID: ${meetingId}`);
            } else {
              console.log(`✅ Meeting joined successfully - ID: ${meetingId}`);
            }
            
            // Respond with success (include lobby status)
            res.json({ 
              success: true, 
              meetingId: meetingId,
              inLobby: result.inLobby || false,
              message: result.inLobby 
                ? 'Bot is waiting in lobby for host admission' 
                : 'Meeting joined successfully',
              browserIndex: browserInfo.browserIndex
            });
          } else {
            // Join failed - release browser and clean up
            const errorMsg = result?.error || 'Unknown error';
            console.error(`❌ Meeting join failed: ${errorMsg}`);
            
            // Release browser slot
            this.browserPool.releaseBrowser(browserInfo.browser, meetingUuid);
            
            // Clean up page
            try {
              await page.close();
            } catch (closeError) {
              console.error('❌ Error closing page after failed join:', closeError);
            }
            
            // Respond with failure
            res.status(500).json({ 
              success: false, 
              error: errorMsg,
              message: `Failed to join meeting: ${errorMsg}`
            });
          }
        } catch (error) {
          console.error('❌ Join error (exception):', error);
          
          // Release browser slot
          this.browserPool.releaseBrowser(browserInfo.browser, meetingUuid);
          
          // Clean up page if join fails
          try {
            await page.close();
          } catch (closeError) {
            console.error('❌ Error closing page after failed join:', closeError);
          }
          
          // Respond with failure
          res.status(500).json({ 
            success: false, 
            error: error.message,
            message: `Failed to join meeting: ${error.message}`
          });
        }
        
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
        
        console.log(`📞 Leave meeting request received - ID: ${meetingId}`);
        
        if (this.activeMeetings.has(meetingId)) {
          const { webexClient, browser } = this.activeMeetings.get(meetingId);
          
          // Cleanup handles everything including closing page
          await webexClient.cleanup();
          
          // Release browser slot back to pool
          this.browserPool.releaseBrowser(browser, meetingId);
          
          this.activeMeetings.delete(meetingId);
          
          console.log(`✅ Meeting left successfully - ID: ${meetingId}`);
          
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
      console.log('   GET  /pool/stats');
      console.log('   POST /join  (body: {meetingUrl, meetingUuid?, hostEmail?})');
      console.log('   POST /leave (body: {meetingId})');
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
      for (const [meetingId, { page, browser }] of this.activeMeetings) {
        console.log(`📞 Closing active meeting: ${meetingId}`);
        await page.close();
        this.browserPool.releaseBrowser(browser, meetingId);
      }
      this.activeMeetings.clear();
      
      // Close browser pool
      if (this.browserPool) {
        await this.browserPool.close();
        this.browserPool = null;
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


