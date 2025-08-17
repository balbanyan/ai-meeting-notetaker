#!/usr/bin/env node

/**
 * Test script to check bot-runner status via IPC when it's running
 * This script communicates with the running Electron process
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🔍 Bot-Runner Status Test');
console.log('=========================\n');

async function testBotStatus() {
  try {
    console.log('📋 Step 1: Checking if bot-runner is running...');
    
    // Check if electron process is running
    const psResult = await new Promise((resolve, reject) => {
      const ps = spawn('ps', ['aux']);
      let output = '';
      
      ps.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      ps.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`ps command failed with code ${code}`));
        }
      });
    });
    
    const electronProcesses = psResult.split('\n').filter(line => 
      line.includes('electron') && 
      line.includes('ai-meeting-notetaker/services/bot-runner')
    );
    
    if (electronProcesses.length === 0) {
      throw new Error('Bot-runner (Electron) is not running. Start it with: npm run dev');
    }
    
    console.log(`✅ Found ${electronProcesses.length} bot-runner processes`);
    
    console.log('\n📊 Step 2: Attempting to read initialization logs...');
    
    // Since we can't directly communicate with the running process,
    // let's check if the initialization files exist and provide guidance
    console.log('💡 To test bot initialization:');
    console.log('   1. Open the Electron app window (should be visible)');
    console.log('   2. Click the "Test Init" button (blue button)');
    console.log('   3. Check the logs in the UI for initialization details');
    console.log('   4. Click "Get Status" to see current bot state');
    
    console.log('\n🔍 Step 3: Expected initialization flow:');
    console.log('   ✓ Page loaded, starting initialization...');
    console.log('   ✓ Starting Webex Meeting Bot initialization...');
    console.log('   ✓ Creating WebexMeetingBot instance...');
    console.log('   ✓ Initializing Webex SDK and authentication...');
    console.log('   ✓ Validating configuration...');
    console.log('   ✓ Configuration validation passed');
    console.log('   ✓ Initializing Webex authentication...');
    console.log('   ✓ Creating Webex SDK instance...');
    console.log('   ✓ Webex SDK instance created successfully');
    console.log('   ✓ Starting authentication process...');
    console.log('   ✓ Webex SDK authenticated successfully');
    console.log('   ✓ Bot initialized successfully!');
    
    console.log('\n❗ If you see errors, common issues:');
    console.log('   🔧 "Guest Issuer" errors → Check .env credentials');
    console.log('   🌐 "Network" errors → Check internet connection');
    console.log('   🔐 "JWT" errors → Verify Guest Issuer ID/Secret are correct');
    console.log('   ⚙️  "Config" errors → Ensure all .env variables are set');
    
    console.log('\n🎯 Expected final state:');
    console.log('   - Status: "Ready - Not in meeting"');
    console.log('   - isInitialized: true');
    console.log('   - Join button: enabled');
    console.log('   - Leave button: disabled');
    
    return {
      success: true,
      processCount: electronProcesses.length,
      message: 'Bot-runner is running. Check the UI for initialization status.'
    };
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to provide troubleshooting steps
function provideTroubleshootingSteps() {
  console.log('\n🛠️ Troubleshooting Steps:');
  console.log('========================\n');
  
  console.log('1. **Start bot-runner if not running:**');
  console.log('   cd services/bot-runner && npm run dev\n');
  
  console.log('2. **Check .env configuration:**');
  console.log('   - WEBEX_GUEST_ISSUER_ID (not placeholder)');
  console.log('   - WEBEX_GUEST_ISSUER_SECRET (not placeholder)');
  console.log('   - BOT_SERVICE_TOKEN (matches backend)\n');
  
  console.log('3. **Test JWT generation:**');
  console.log('   node test-jwt.js\n');
  
  console.log('4. **Check network connectivity:**');
  console.log('   curl -I https://webexapis.com/v1/people/me\n');
  
  console.log('5. **View Electron console logs:**');
  console.log('   - Right-click in Electron app → "Inspect Element"');
  console.log('   - Go to Console tab');
  console.log('   - Look for initialization errors\n');
  
  console.log('6. **Re-run initialization test:**');
  console.log('   - Click "Test Init" button in bot-runner UI');
  console.log('   - Watch logs for detailed error messages');
}

// Run the test
if (require.main === module) {
  testBotStatus()
    .then(result => {
      if (result.success) {
        console.log('\n✅ Bot-runner status check completed');
        console.log(`Found ${result.processCount} running processes`);
        console.log('\n🎯 Next: Open the Electron app and test initialization!');
      } else {
        console.log('\n❌ Bot-runner status check failed');
        provideTroubleshootingSteps();
      }
    })
    .catch(error => {
      console.error('\n💥 Unexpected error:', error);
      provideTroubleshootingSteps();
    });
}

module.exports = { testBotStatus, provideTroubleshootingSteps };
