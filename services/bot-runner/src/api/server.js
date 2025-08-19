const express = require('express');
const cors = require('cors');
const { config } = require('../utils/config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('BotAPIServer');

class BotAPIServer {
  constructor(mainWindow = null) {
    this.app = express();
    this.port = config.api.port;
    this.server = null;
    this.mainWindow = mainWindow;
    this.isInitialized = false;
  }

  /**
   * Initialize the API server
   */
  async initialize() {
    try {
      logger.info('Initializing Bot API Server...');

      this.isInitialized = true;

      // Setup Express middleware
    this.setupMiddleware();

      // Setup routes
    this.setupRoutes();

      logger.info('✅ Bot API Server initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize Bot API Server:', error);
      throw error;
    }
  }

  /**
   * Set the main window reference for IPC communication
   */
  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Enable CORS
    this.app.use(cors());

    // Parse JSON bodies
    this.app.use(express.json());
    
    // Request logging middleware
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path} - ${req.ip}`);
      next();
    });

    // Authentication middleware
    this.app.use('/api', this.authenticateRequest.bind(this));
  }

  /**
   * Authentication middleware
   */
  authenticateRequest(req, res, next) {
    // Skip authentication for status endpoint (for basic health checks)
    if (req.path === '/status' && req.method === 'GET') {
      return next();
    }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header'
      });
      }
      
      const token = authHeader.replace('Bearer ', '');
      if (token !== config.bot.serviceToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid bot service token'
      });
      }
      
      next();
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check endpoint (no auth required)
    this.app.get('/api/status', this.getStatus.bind(this));

    // Meeting control endpoints (auth required)
    this.app.post('/api/join-meeting', this.joinMeeting.bind(this));
    this.app.post('/api/leave-meeting', this.leaveMeeting.bind(this));

    // Error handler
    this.app.use(this.errorHandler.bind(this));
  }

  /**
   * Get bot status endpoint
   */
  async getStatus(req, res) {
    try {
      let botStatus = {
        isInMeeting: false,
        meetingData: null,
        isAudioProcessing: false,
        isWebSocketConnected: false
      };

      // Get bot status from renderer process if available
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        try {
          const result = await this.mainWindow.webContents.executeJavaScript(`
            window.webexBot ? window.webexBot.getMeetingStatus() : null
          `);
          if (result) {
            botStatus = result;
          }
        } catch (error) {
          logger.warn('Could not get bot status from renderer:', error.message);
        }
      }

      const status = {
        server: {
          isRunning: true,
          isInitialized: this.isInitialized,
          port: this.port,
          timestamp: new Date().toISOString()
        },
        bot: botStatus,
        config: {
          hasGuestIssuer: !!(config.webex.guestIssuerId && config.webex.guestIssuerSecret),
          hasServiceToken: !!config.bot.serviceToken,
          backendUrl: config.backend.apiUrl
        }
      };

      res.json(status);
    } catch (error) {
      logger.error('Error getting status:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get bot status'
      });
    }
  }

  /**
   * Join meeting endpoint
   */
  async joinMeeting(req, res) {
    try {
      const { meetingUrl, title, hostEmail } = req.body;

      // Validate request
      if (!meetingUrl) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'meetingUrl is required'
        });
      }

      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Renderer process not available'
        });
      }

      logger.info(`Received join request for meeting: ${meetingUrl}`);

      // Use IPC to join meeting via renderer process
      const result = await this.mainWindow.webContents.executeJavaScript(`
        (async function() {
          try {
            if (!window.webexBot) {
              throw new Error('Webex bot not initialized in renderer');
            }
            
            // Check if already in meeting
            const status = window.webexBot.getMeetingStatus();
            if (status.isInMeeting) {
              throw new Error('Bot is already in a meeting');
            }
            
            // Join meeting using the core function
            const result = await window.webexBot.joinMeeting('${meetingUrl}', '${hostEmail || ''}');
            return { success: true, result };
          } catch (error) {
            return { success: false, error: error.message };
          }
        })()
      `);

      if (result.success) {
        logger.info('Successfully joined meeting via API');
          res.json({
          success: true,
          message: 'Successfully joined meeting',
          meeting: result.result
          });
        } else {
        logger.error('Failed to join meeting:', result.error);
          res.status(500).json({
          error: 'Internal Server Error',
          message: `Failed to join meeting: ${result.error}`
          });
        }

      } catch (error) {
        logger.error('Error joining meeting:', error);
        res.status(500).json({ 
        error: 'Internal Server Error',
        message: `Failed to join meeting: ${error.message}`
      });
    }
  }

  /**
   * Leave meeting endpoint
   */
  async leaveMeeting(req, res) {
    try {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Renderer process not available'
        });
      }

      logger.info('Received leave request');

      // Use IPC to leave meeting via renderer process
      const result = await this.mainWindow.webContents.executeJavaScript(`
        (async function() {
          try {
            if (!window.webexBot) {
              throw new Error('Webex bot not initialized in renderer');
            }
            
            // Check if currently in meeting
            const status = window.webexBot.getMeetingStatus();
            if (!status.isInMeeting) {
              throw new Error('Bot is not currently in a meeting');
            }
            
            // Leave meeting using the core function
            await window.webexBot.leaveMeeting();
            return { success: true };
          } catch (error) {
            return { success: false, error: error.message };
          }
        })()
      `);

      if (result.success) {
        logger.info('Successfully left meeting via API');
        res.json({
          success: true,
          message: 'Successfully left meeting'
        });
      } else {
        logger.error('Failed to leave meeting:', result.error);
        res.status(400).json({
          error: 'Bad Request',
          message: result.error
        });
      }

      } catch (error) {
        logger.error('Error leaving meeting:', error);
        res.status(500).json({ 
        error: 'Internal Server Error',
        message: `Failed to leave meeting: ${error.message}`
      });
    }
  }

  /**
   * Error handler middleware
   */
  errorHandler(error, req, res, next) {
    logger.error('Unhandled error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred'
    });
  }

  /**
   * Start the API server
   */
  async start() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return new Promise((resolve, reject) => {
        this.server = this.app.listen(this.port, (error) => {
          if (error) {
            logger.error(`Failed to start API server on port ${this.port}:`, error);
            reject(error);
          } else {
            logger.info(`🚀 Bot API Server started on http://localhost:${this.port}`);
            logger.info('Available endpoints:');
            logger.info('  GET  /api/status        - Bot status (no auth)');
            logger.info('  POST /api/join-meeting  - Join meeting (auth required)');
            logger.info('  POST /api/leave-meeting - Leave meeting (auth required)');
            resolve();
          }
        });
      });
    } catch (error) {
      logger.error('Failed to start API server:', error);
      throw error;
    }
  }

  /**
   * Stop the API server
   */
  async stop() {
    return new Promise((resolve) => {
    if (this.server) {
        this.server.close(() => {
          logger.info('Bot API Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = { BotAPIServer };
