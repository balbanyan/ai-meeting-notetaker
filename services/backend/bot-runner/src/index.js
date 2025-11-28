#!/usr/bin/env node

async function main() {
  try {
    console.log('🚀 Starting AI Meeting Notetaker Bot Runner...');
      console.log('   - Using Puppeteer for browser automation');
    console.log('   - Headless mode (no GUI)');
      
      const { HeadlessRunner } = require('./headless/manager');
      const runner = new HeadlessRunner();
      await runner.start();
    
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
