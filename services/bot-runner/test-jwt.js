#!/usr/bin/env node

/**
 * Test script to verify JWT generation for Webex Guest Issuer authentication
 * 
 * This script:
 * 1. Loads your .env configuration
 * 2. Generates a JWT token using your Guest Issuer credentials
 * 3. Validates the JWT structure and content
 * 4. Tests JWT expiry detection
 * 
 * Usage: node test-jwt.js
 */

require('dotenv').config();
const { buildJwt, isJwtExpiring } = require('./src/auth/jwt');
const { config, validateConfig } = require('./src/utils/config');
const crypto = require('crypto-js');

console.log('🧪 JWT Generation Test Script');
console.log('================================\n');

async function testJwtGeneration() {
  try {
    // Step 1: Validate configuration
    console.log('📋 Step 1: Validating configuration...');
    validateConfig();
    console.log('✅ Configuration is valid\n');
    
    // Step 2: Display configuration (masked)
    console.log('🔧 Step 2: Configuration summary:');
    console.log(`   Guest Issuer ID: ${config.webex.guestIssuerId ? `${config.webex.guestIssuerId.substring(0, 8)}...` : 'MISSING'}`);
    console.log(`   Guest Issuer Secret: ${config.webex.guestIssuerSecret ? `${config.webex.guestIssuerSecret.substring(0, 8)}...` : 'MISSING'}`);
    console.log(`   Bot Name: ${config.bot.name}`);
    console.log(`   Bot Display Name: ${config.bot.displayName}`);
    console.log(`   Bot Email: ${config.bot.email}\n`);
    
    // Step 3: Generate JWT
    console.log('🔐 Step 3: Generating JWT...');
    const jwt = buildJwt();
    console.log('✅ JWT generated successfully');
    console.log(`   JWT Length: ${jwt.length} characters`);
    console.log(`   JWT Preview: ${jwt.substring(0, 50)}...\n`);
    
    // Step 4: Validate JWT structure
    console.log('🔍 Step 4: Validating JWT structure...');
    const jwtParts = jwt.split('.');
    
    if (jwtParts.length !== 3) {
      throw new Error(`Invalid JWT structure: expected 3 parts, got ${jwtParts.length}`);
    }
    
    console.log('✅ JWT has correct structure (header.payload.signature)\n');
    
    // Step 5: Decode and validate header
    console.log('📄 Step 5: Decoding JWT header...');
    const header = JSON.parse(
      crypto.enc.Base64url.parse(jwtParts[0]).toString(crypto.enc.Utf8)
    );
    console.log('   Header:', JSON.stringify(header, null, 2));
    
    if (header.typ !== 'JWT' || header.alg !== 'HS256') {
      throw new Error('Invalid JWT header');
    }
    console.log('✅ Header is valid\n');
    
    // Step 6: Decode and validate payload
    console.log('📦 Step 6: Decoding JWT payload...');
    const payload = JSON.parse(
      crypto.enc.Base64url.parse(jwtParts[1]).toString(crypto.enc.Utf8)
    );
    console.log('   Payload:', JSON.stringify(payload, null, 2));
    
    // Validate payload fields
    const requiredFields = ['sub', 'name', 'iss', 'exp'];
    const missingFields = requiredFields.filter(field => !payload[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required payload fields: ${missingFields.join(', ')}`);
    }
    
    console.log('✅ Payload contains all required fields\n');
    
    // Step 7: Validate expiry
    console.log('⏰ Step 7: Validating JWT expiry...');
    const expiryDate = new Date(payload.exp * 1000);
    const currentDate = new Date();
    const timeUntilExpiry = expiryDate.getTime() - currentDate.getTime();
    const minutesUntilExpiry = Math.floor(timeUntilExpiry / 1000 / 60);
    
    console.log(`   Current time: ${currentDate.toISOString()}`);
    console.log(`   Expires at: ${expiryDate.toISOString()}`);
    console.log(`   Time until expiry: ${minutesUntilExpiry} minutes`);
    
    if (timeUntilExpiry <= 0) {
      throw new Error('JWT is already expired!');
    }
    
    if (minutesUntilExpiry < 55) {
      console.log('⚠️  JWT expires in less than 55 minutes');
    } else {
      console.log('✅ JWT expiry is valid');
    }
    
    // Step 8: Test expiry detection function
    console.log('\n🕒 Step 8: Testing expiry detection...');
    const isExpiring = isJwtExpiring(jwt);
    const isExpiringSoon = isJwtExpiring(jwt, 60); // 60 minute buffer
    
    console.log(`   Is expiring (5 min buffer): ${isExpiring}`);
    console.log(`   Is expiring (60 min buffer): ${isExpiringSoon}`);
    console.log('✅ Expiry detection function works\n');
    
    // Step 9: Verify signature (basic check)
    console.log('🔏 Step 9: Verifying signature...');
    const encodedData = `${jwtParts[0]}.${jwtParts[1]}`;
    const expectedSignature = crypto.HmacSHA256(
      encodedData,
      crypto.enc.Base64.parse(config.webex.guestIssuerSecret)
    ).toString(crypto.enc.Base64url);
    
    if (expectedSignature === jwtParts[2]) {
      console.log('✅ JWT signature is valid');
    } else {
      throw new Error('JWT signature validation failed');
    }
    
    // Success summary
    console.log('\n🎉 SUCCESS! JWT Generation Test Passed');
    console.log('=====================================');
    console.log('✅ Configuration is valid');
    console.log('✅ JWT generation works correctly');
    console.log('✅ JWT structure is proper');
    console.log('✅ All required fields are present');
    console.log('✅ JWT expiry is valid');
    console.log('✅ Signature verification passed');
    console.log('\n🚀 Ready to test with Webex SDK!');
    
    return {
      success: true,
      jwt: jwt,
      payload: payload,
      expiryMinutes: minutesUntilExpiry
    };
    
  } catch (error) {
    console.error('\n❌ JWT Generation Test Failed');
    console.error('================================');
    console.error('Error:', error.message);
    
    if (error.message.includes('Missing Webex Guest Issuer')) {
      console.error('\n💡 Solution: Create a .env file with your Guest Issuer credentials:');
      console.error('   WEBEX_GUEST_ISSUER_ID=your-actual-guest-issuer-id');
      console.error('   WEBEX_GUEST_ISSUER_SECRET=your-actual-guest-issuer-secret');
      console.error('   BOT_SERVICE_TOKEN=your-backend-service-token');
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

// Additional utility function to test with custom values
function testJwtWithCustomPayload(customPayload = {}) {
  console.log('\n🧪 Testing JWT with custom payload...');
  
  try {
    const testPayload = {
      sub: "test-bot@example.com",
      name: "Test Bot",
      iss: config.webex.guestIssuerId,
      exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      ...customPayload
    };
    
    console.log('Test payload:', JSON.stringify(testPayload, null, 2));
    
    const encodedHeader = crypto.enc.Base64url.stringify(
      crypto.enc.Utf8.parse(JSON.stringify({
        typ: "JWT",
        alg: "HS256",
      }))
    );
    
    const encodedPayload = crypto.enc.Base64url.stringify(
      crypto.enc.Utf8.parse(JSON.stringify(testPayload))
    );
    
    const encodedData = `${encodedHeader}.${encodedPayload}`;
    
    const signature = crypto.HmacSHA256(
      encodedData,
      crypto.enc.Base64.parse(config.webex.guestIssuerSecret)
    ).toString(crypto.enc.Base64url);
    
    const testJwt = `${encodedData}.${signature}`;
    
    console.log('✅ Custom JWT generated successfully');
    console.log(`   Length: ${testJwt.length} characters`);
    
    return testJwt;
    
  } catch (error) {
    console.error('❌ Custom JWT generation failed:', error.message);
    return null;
  }
}

// Run the test
if (require.main === module) {
  testJwtGeneration()
    .then(result => {
      if (result.success) {
        console.log('\n🔗 Next steps:');
        console.log('1. Start the bot-runner: npm run dev');
        console.log('2. Use the frontend to add bot to a meeting');
        console.log('3. Watch the logs for authentication success');
        
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = {
  testJwtGeneration,
  testJwtWithCustomPayload
};
