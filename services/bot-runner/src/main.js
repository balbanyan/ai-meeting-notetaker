const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { validateConfig } = require('./utils/config');
const { createLogger } = require('./utils/logger');

const logger = createLogger('ElectronMain');

class BotRunnerApp {
  constructor() {
    this.mainWindow = null;
    this.isQuitting = false;
  }

  /**
   * Initialize the Electron application
   */
  async initialize() {
    try {
      // Validate configuration
      validateConfig();
      logger.info('Configuration validated successfully');
      
      // Set up Electron app events
      this.setupAppEvents();
      
      // Set up IPC handlers
      this.setupIpcHandlers();
      
      logger.info('Bot Runner App initialized');
      
    } catch (error) {
      logger.error('Failed to initialize Bot Runner App:', error);
      app.quit();
    }
  }

  /**
   * Set up Electron app event handlers
   */
  setupAppEvents() {
    app.whenReady().then(() => {
      this.createMainWindow();
      
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createMainWindow();
        }
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('before-quit', () => {
      this.isQuitting = true;
    });
  }

  /**
   * Create the main application window
   */
  createMainWindow() {
    logger.info('Creating main window...');
    
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false, // Start hidden for headless operation
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: false // Needed for Webex SDK
      }
    });

    // Load the renderer page
    this.mainWindow.loadFile(path.join(__dirname, 'renderer.html'));

    // Handle window events
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    this.mainWindow.on('ready-to-show', () => {
      logger.info('Main window ready');
      
      // Show window only in development
      if (process.env.NODE_ENV === 'development') {
        this.mainWindow.show();
        this.mainWindow.webContents.openDevTools();
      }
    });

    logger.info('Main window created');
  }

  /**
   * Set up IPC communication handlers
   */
  setupIpcHandlers() {
    // Handle join meeting request
    ipcMain.handle('join-meeting', async (event, { meetingLink, hostEmail }) => {
      try {
        logger.info(`Received join meeting request: ${meetingLink}`);
        
        // Send to renderer for processing
        const result = await this.mainWindow.webContents.executeJavaScript(`
          window.webexBot.joinMeeting('${meetingLink}', '${hostEmail}')
        `);
        
        return { success: true, result };
        
      } catch (error) {
        logger.error('Failed to join meeting:', error);
        return { success: false, error: error.message };
      }
    });

    // Handle leave meeting request
    ipcMain.handle('leave-meeting', async (event) => {
      try {
        logger.info('Received leave meeting request');
        
        // Send to renderer for processing
        const result = await this.mainWindow.webContents.executeJavaScript(`
          window.webexBot.leaveMeeting()
        `);
        
        return { success: true, result };
        
      } catch (error) {
        logger.error('Failed to leave meeting:', error);
        return { success: false, error: error.message };
      }
    });

    // Handle get status request
    ipcMain.handle('get-status', async (event) => {
      try {
        const status = await this.mainWindow.webContents.executeJavaScript(`
          window.webexBot.getMeetingStatus()
        `);
        
        return { success: true, status };
        
      } catch (error) {
        logger.error('Failed to get status:', error);
        return { success: false, error: error.message };
      }
    });

    logger.info('IPC handlers set up');
  }

  /**
   * Send message to renderer process
   */
  sendToRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }
}

// Create and initialize the app
const botApp = new BotRunnerApp();

// Handle potential errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Initialize when ready
app.whenReady().then(() => {
  botApp.initialize();
});

module.exports = { BotRunnerApp };
