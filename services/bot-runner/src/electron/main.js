const { app, BrowserWindow } = require('electron');
const path = require('path');
const { validateConfig } = require('../shared/config');

class BotRunnerApp {
  constructor() {
    this.mainWindow = null;
  }

  /**
   * Initialize the Electron application
   */
  async initialize() {
    try {
      // Validate configuration
      validateConfig();
      console.log('✅ Bot Runner V2 initialized');
      
      // Set up Electron app events
      this.setupAppEvents();
      
    } catch (error) {
      console.error('❌ Failed to initialize Bot Runner:', error);
      app.quit();
    }
  }

  /**
   * Set up Electron application events
   */
  setupAppEvents() {
    app.whenReady().then(() => {
      this.createWindow();
      
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createWindow();
        }
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('before-quit', () => {
      console.log('🛑 Bot Runner shutting down...');
    });
  }

  /**
   * Create the main browser window
   */
  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false // For development only
      },
      title: 'AI Meeting Notetaker - Bot Runner'
    });

    // Load the HTML file
    this.mainWindow.loadFile(path.join(__dirname, 'renderer.html'));

    // Open DevTools for debugging console logs
    this.mainWindow.webContents.openDevTools();
    
    // Log when DevTools is ready
    this.mainWindow.webContents.once('devtools-opened', () => {
      console.log('🔧 DevTools opened - Console available for debugging');
      console.log('🔍 Try: debugWebex(), debugMeeting(), testAudio()');
    });

    console.log('✅ Main window created');
  }
}

// Initialize the application
const botApp = new BotRunnerApp();
botApp.initialize();
