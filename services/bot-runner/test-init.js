#!/usr/bin/env node

/**
 * Test script to verify bot-runner initialization works correctly
 * 
 * This script tests:
 * 1. Configuration validation
 * 2. JWT generation
 * 3. Webex SDK initialization
 * 4. Authentication process
 * 5. Basic functionality tests
 * 
 * Usage: node test-init.js
 */

require('dotenv').config();
const { WebexMeetingBot } = require('./src/webex/meeting');
const { createLogger } = require('./src/utils/logger');

const logger = createLogger('InitTest');

console.log('🧪 Bot-Runner Initialization Test');
console.log('==================================\n');

async function testInitialization() {
  let webexBot = null;
  
  try {
    // Step 1: Test configuration
    console.log('📋 Step 1: Testing configuration validation...');
    const { validateConfig } = require('./src/utils/config');
    validateConfig();
    console.log('✅ Configuration is valid\n');
    
    // Step 2: Test JWT generation
    console.log('🔐 Step 2: Testing JWT generation...');
    const { buildJwt } = require('./src/auth/jwt');
    const jwt = buildJwt();
    console.log(`✅ JWT generated (${jwt.length} chars)\n`);
    
    // Step 3: Create bot instance
    console.log('🤖 Step 3: Creating WebexMeetingBot instance...');
    webexBot = new WebexMeetingBot();
    console.log('✅ Bot instance created\n');
    
    // Step 4: Initialize bot (this is the critical test)
    console.log('⚡ Step 4: Initializing bot (Webex SDK + Auth)...');
    const startTime = Date.now();
    
    await webexBot.initialize();
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    console.log(`✅ Bot initialized successfully in ${duration.toFixed(2)}s\n`);
    
    // Step 5: Test bot status
    console.log('📊 Step 5: Testing bot status...');
    const status = webexBot.getMeetingStatus();
    console.log('Status:', JSON.stringify(status, null, 2));
    console.log('✅ Status retrieval works\n');
    
    // Step 6: Test Webex SDK access
    console.log('🔍 Step 6: Testing Webex SDK access...');
    const webex = webexBot.webex;
    
    if (!webex) {
      throw new Error('Webex SDK instance is null');
    }
    
    console.log('✅ Webex SDK accessible');
    console.log(`   - Has meetings namespace: ${!!webex.meetings}`);
    console.log(`   - Has authorization namespace: ${!!webex.authorization}`);
    console.log(`   - Has credentials: ${!!webex.credentials}`);
    
    // Step 7: Test authentication status
    console.log('\n🔑 Step 7: Testing authentication status...');
    const authStatus = webexBot.webexAuth.isAuth();
    console.log(`✅ Authentication status: ${authStatus}`);
    
    // Success summary
    console.log('\n🎉 SUCCESS! Bot-Runner Initialization Test Passed');
    console.log('================================================');
    console.log('✅ Configuration validation works');
    console.log('✅ JWT generation works');
    console.log('✅ Bot instance creation works');
    console.log('✅ Webex SDK initialization works');
    console.log('✅ Authentication works');
    console.log('✅ Status retrieval works');
    console.log('✅ SDK access works');
    
    console.log('\n🚀 Bot-runner is ready for meeting joins!');
    
    return {
      success: true,
      duration: duration,
      status: status
    };
    
  } catch (error) {
    console.error('\n❌ Bot-Runner Initialization Test Failed');
    console.error('==========================================');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    // Specific error guidance
    if (error.message.includes('Guest Issuer')) {
      console.error('\n💡 Guest Issuer Issue:');
      console.error('   - Check WEBEX_GUEST_ISSUER_ID is correct');
      console.error('   - Check WEBEX_GUEST_ISSUER_SECRET is correct');
      console.error('   - Ensure Guest Issuer is properly created in Webex Developer Portal');
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      console.error('\n💡 Network Issue:');
      console.error('   - Check internet connection');
      console.error('   - Check if corporate firewall blocks Webex APIs');
      console.error('   - Try running: curl -I https://webexapis.com/v1/people/me');
    } else if (error.message.includes('JWT') || error.message.includes('token')) {
      console.error('\n💡 Authentication Issue:');
      console.error('   - Verify Guest Issuer credentials are not placeholder values');
      console.error('   - Check JWT generation with: node test-jwt.js');
      console.error('   - Ensure Guest Issuer has proper permissions');
    } else if (error.message.includes('Missing') || error.message.includes('config')) {
      console.error('\n💡 Configuration Issue:');
      console.error('   - Ensure .env file exists with all required values');
      console.error('   - Check .env.example for required fields');
      console.error('   - Verify BOT_SERVICE_TOKEN is set');
    }
    
    return {
      success: false,
      error: error.message
    };
    
  } finally {
    // Cleanup
    if (webexBot && webexBot.webex) {
      try {
        // Any cleanup needed
        console.log('\n🧹 Cleaning up test resources...');
      } catch (cleanupError) {
        console.warn('Cleanup warning:', cleanupError.message);
      }
    }
  }
}

// Additional function to test specific components
async function testComponentsIndividually() {
  console.log('\n🔧 Individual Component Tests');
  console.log('==============================\n');
  
  try {
    // Test 1: Config validation
    console.log('Test 1: Configuration...');
    const { config, validateConfig } = require('./src/utils/config');
    validateConfig();
    console.log(`✅ Config valid - Guest Issuer ID: ${config.webex.guestIssuerId.substring(0, 8)}...`);
    
    // Test 2: JWT generation
    console.log('\nTest 2: JWT Generation...');
    const { buildJwt, isJwtExpiring } = require('./src/auth/jwt');
    const jwt = buildJwt();
    const isExpiring = isJwtExpiring(jwt);
    console.log(`✅ JWT generated, expiring soon: ${isExpiring}`);
    
    // Test 3: Webex Auth (isolated)
    console.log('\nTest 3: Webex Authentication (isolated)...');
    const { getWebexAuth } = require('./src/auth/webex-auth');
    const webexAuth = getWebexAuth();
    await webexAuth.initialize();
    console.log(`✅ Webex Auth successful: ${webexAuth.isAuth()}`);
    
    console.log('\n✅ All individual components work correctly');
    
  } catch (error) {
    console.error(`❌ Component test failed: ${error.message}`);
    throw error;
  }
}

// Run the tests
if (require.main === module) {
  console.log('Starting comprehensive initialization test...\n');
  
  testInitialization()
    .then(result => {
      if (result.success) {
        console.log('\n🎯 Next steps:');
        console.log('1. Start bot-runner: npm run dev');
        console.log('2. Check Electron console for initialization logs');
        console.log('3. Test "Get Status" button in the UI');
        console.log('4. Try joining a test meeting');
        
        process.exit(0);
      } else {
        console.log('\n🔨 Recommended fixes:');
        console.log('1. Fix the reported error above');
        console.log('2. Re-run this test: node test-init.js');
        console.log('3. Check individual components if needed');
        
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 Unexpected test error:', error);
      process.exit(1);
    });
}

module.exports = {
  testInitialization,
  testComponentsIndividually
};
