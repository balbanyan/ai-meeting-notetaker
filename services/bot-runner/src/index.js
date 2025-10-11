#!/usr/bin/env node

const { program } = require('commander');
const path = require('path');
const { config } = require('./shared/config');

// Configure command line options
program
  .name('ai-meeting-notetaker-bot')
  .description('AI Meeting Notetaker Bot Runner - supports GUI and headless modes')
  .version('2.0.0')
  .option('--headless', 'Run in headless mode using Puppeteer')
  .option('--gui', 'Run in GUI mode using Electron (default)')
  .parse();

const options = program.opts();

// Determine mode - Priority: CLI args > BOT_MODE env > HEADLESS_MODE env (backward compatibility) > default
let isHeadless = false;
if (options.headless) {
  isHeadless = true;
} else if (options.gui) {
  isHeadless = false;
} else if (config.mode.type === 'headless') {
  isHeadless = true;
} else if (process.env.HEADLESS_MODE === 'true') {
  // Backward compatibility
  isHeadless = true;
} else {
  isHeadless = true; // Default to headless
}

async function main() {
  try {
    // Show mode selection info
    const modeSource = options.headless ? 'CLI --headless' : 
                      options.gui ? 'CLI --gui' :
                      config.mode.type === 'headless' ? 'BOT_MODE=headless' :
                      process.env.HEADLESS_MODE === 'true' ? 'HEADLESS_MODE=true' :
                      'default';
    
    console.log(`🎯 Mode: ${isHeadless ? 'HEADLESS' : 'GUI'} (source: ${modeSource})`);
    
    if (isHeadless) {
      console.log('🤖 Starting AI Meeting Notetaker in HEADLESS mode...');
      console.log('   - Using Puppeteer for browser automation');
      console.log('   - No GUI will be displayed');
      
      const { HeadlessRunner } = require('./headless/manager');
      const runner = new HeadlessRunner();
      await runner.start();
      
    } else {
      console.log('🖥️ Starting AI Meeting Notetaker in GUI mode...');
      console.log('   - Using Electron with visible interface');
      console.log('   - Web UI will be available');
      
      // Spawn Electron process instead of requiring the main.js directly
      const { spawn } = require('child_process');
      const electronPath = require('electron');
      const mainPath = path.join(__dirname, 'electron', 'main.js');
      
      const electronProcess = spawn(electronPath, [mainPath], {
        stdio: ['ignore', 'pipe', 'pipe'], // Don't inherit stdio to prevent EPIPE errors
        env: { ...process.env, ELECTRON_IS_DEV: '1' }
      });
      
      // Handle Electron process output safely
      if (electronProcess.stdout) {
        electronProcess.stdout.on('data', (data) => {
          try {
            process.stdout.write(data);
          } catch (error) {
            // Ignore EPIPE errors when parent process stdio is closed
            if (error.code !== 'EPIPE') {
              console.error('Stdout error:', error.message);
            }
          }
        });
      }
      
      if (electronProcess.stderr) {
        electronProcess.stderr.on('data', (data) => {
          try {
            process.stderr.write(data);
          } catch (error) {
            // Ignore EPIPE errors when parent process stdio is closed
            if (error.code !== 'EPIPE') {
              console.error('Stderr error:', error.message);
            }
          }
        });
      }
      
      // Handle process errors
      electronProcess.on('error', (error) => {
        console.error('❌ Failed to start Electron process:', error.message);
        process.exit(1);
      });
      
      electronProcess.on('close', (code) => {
        console.log(`Electron process exited with code ${code}`);
        process.exit(code);
      });
    }
    
  } catch (error) {
    console.error('❌ Failed to start bot runner:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Start the application
main().catch((error) => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});
