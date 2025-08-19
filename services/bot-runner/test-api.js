#!/usr/bin/env node

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';
const BOT_TOKEN = process.env.BOT_SERVICE_TOKEN || 'your-bot-service-token-here';

async function testApi() {
  console.log('🧪 Testing Bot Runner API...\n');

  try {
    // Test 1: Health check (no auth required)
    console.log('1️⃣ Testing GET /api/status (no auth)...');
    try {
      const response = await axios.get(`${BASE_URL}/api/status`);
      console.log('✅ Status check passed');
      console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.log('❌ Status check failed:', error.message);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 2: Status with auth header
    console.log('2️⃣ Testing GET /api/status (with auth)...');
    try {
      const response = await axios.get(`${BASE_URL}/api/status`, {
        headers: {
          'Authorization': `Bearer ${BOT_TOKEN}`
        }
      });
      console.log('✅ Authenticated status check passed');
      console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.log('❌ Authenticated status check failed:', error.message);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 3: Join meeting without auth (should fail)
    console.log('3️⃣ Testing POST /api/join-meeting (no auth - should fail)...');
    try {
      const response = await axios.post(`${BASE_URL}/api/join-meeting`, {
        meetingUrl: 'https://meet.webex.com/test-meeting'
      });
      console.log('❌ Should have failed without auth, but got:', response.status);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log('✅ Correctly rejected unauthorized request');
        console.log('Response:', error.response.data);
      } else {
        console.log('❌ Unexpected error:', error.message);
      }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 4: Join meeting with invalid token (should fail)
    console.log('4️⃣ Testing POST /api/join-meeting (invalid token - should fail)...');
    try {
      const response = await axios.post(`${BASE_URL}/api/join-meeting`, {
        meetingUrl: 'https://meet.webex.com/test-meeting'
      }, {
        headers: {
          'Authorization': 'Bearer invalid-token'
        }
      });
      console.log('❌ Should have failed with invalid token, but got:', response.status);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log('✅ Correctly rejected invalid token');
        console.log('Response:', error.response.data);
      } else {
        console.log('❌ Unexpected error:', error.message);
      }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 5: Join meeting with valid token (should work if bot is ready)
    console.log('5️⃣ Testing POST /api/join-meeting (valid token)...');
    try {
      const response = await axios.post(`${BASE_URL}/api/join-meeting`, {
        meetingUrl: 'https://meet.webex.com/test-meeting-api',
        title: 'API Test Meeting',
        hostEmail: 'test@example.com'
      }, {
        headers: {
          'Authorization': `Bearer ${BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('✅ Join meeting request sent successfully');
      console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      if (error.response) {
        console.log(`❌ Join meeting failed with status ${error.response.status}`);
        console.log('Response:', error.response.data);
      } else {
        console.log('❌ Join meeting failed:', error.message);
      }
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 6: Leave meeting
    console.log('6️⃣ Testing POST /api/leave-meeting...');
    try {
      const response = await axios.post(`${BASE_URL}/api/leave-meeting`, {}, {
        headers: {
          'Authorization': `Bearer ${BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('✅ Leave meeting request sent successfully');
      console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      if (error.response) {
        console.log(`❌ Leave meeting failed with status ${error.response.status}`);
        console.log('Response:', error.response.data);
      } else {
        console.log('❌ Leave meeting failed:', error.message);
      }
    }

  } catch (error) {
    console.log('❌ API test suite failed:', error.message);
  }

  console.log('\n🏁 API testing completed!');
}

// Check if BOT_SERVICE_TOKEN is set
if (BOT_TOKEN === 'your-bot-service-token-here') {
  console.log('⚠️  Warning: BOT_SERVICE_TOKEN not set. Using placeholder token.');
  console.log('   Set BOT_SERVICE_TOKEN environment variable for full testing.\n');
}

testApi();
