// API client for backend communication

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080'

// Log backend URL on module load
console.log('🔧 API Client Configuration:')
console.log('  Backend URL:', BACKEND_URL)
console.log('  Environment:', import.meta.env.MODE || 'development')

// Logging utility for API calls
const logger = {
  request: (method, url, data = null) => {
    console.group(`🌐 API Request: ${method} ${url}`)
    console.log('⏰ Time:', new Date().toLocaleTimeString())
    console.log('🔗 Full URL:', url)
    if (data) {
      console.log('📤 Request Body:', data)
    }
    console.groupEnd()
  },
  
  response: (method, url, status, data, duration) => {
    const emoji = status >= 200 && status < 300 ? '✅' : '❌'
    console.group(`${emoji} API Response: ${method} ${url} - ${status}`)
    console.log('⏰ Time:', new Date().toLocaleTimeString())
    console.log('⏱️ Duration:', `${duration}ms`)
    console.log('📊 Status:', status)
    console.log('📥 Response Data:', data)
    console.groupEnd()
  },
  
  error: (method, url, error, duration) => {
    console.group(`❌ API Error: ${method} ${url}`)
    console.log('⏰ Time:', new Date().toLocaleTimeString())
    console.log('⏱️ Duration:', `${duration}ms`)
    console.error('🚨 Error:', error)
    console.error('📋 Error Message:', error.message)
    if (error.stack) {
      console.error('📚 Stack Trace:', error.stack)
    }
    console.groupEnd()
  }
}

// Helper function to make API calls with logging
async function apiCall(method, endpoint, body = null) {
  const url = `${BACKEND_URL}${endpoint}`
  const startTime = performance.now()
  
  try {
    // Log request
    logger.request(method, url, body)
    
    // Make request
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    }
    
    if (body) {
      options.body = JSON.stringify(body)
    }
    
    const response = await fetch(url, options)
    const duration = Math.round(performance.now() - startTime)
    
    // Parse response
    let data
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      data = await response.json()
    } else {
      data = await response.text()
    }
    
    // Log response
    logger.response(method, url, response.status, data, duration)
    
    // Check if response is ok
    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data.detail 
        ? data.detail 
        : typeof data === 'string' 
          ? data 
          : `HTTP ${response.status}: ${response.statusText}`
      throw new Error(errorMessage)
    }
    
    return data
  } catch (error) {
    const duration = Math.round(performance.now() - startTime)
    logger.error(method, url, error, duration)
    throw error
  }
}

/**
 * Register meeting and trigger bot join
 * @param {Object} meetingData - Meeting data from Webex SDK
 * @returns {Promise<Object>} Response from backend
 */
export async function registerAndJoinMeeting(meetingData) {
  return apiCall('POST', '/api/meetings/register-and-join', meetingData)
}

/**
 * Fetch all completed meetings (is_active = false)
 * @returns {Promise<Object>} List of meetings with total count
 */
export async function fetchMeetings() {
  return apiCall('GET', '/api/meetings/list')
}

/**
 * Fetch detailed meeting information including transcripts
 * @param {string} meetingUuid - Meeting UUID
 * @returns {Promise<Object>} Meeting details with transcripts
 */
export async function fetchMeetingDetails(meetingUuid) {
  return apiCall('GET', `/api/meetings/${meetingUuid}`)
}

/**
 * Get current meeting status (for checking if bot is active)
 * @param {string} meetingId - Webex meeting ID
 * @returns {Promise<Object>} Object with is_active boolean
 */
export async function getMeetingStatus(meetingId) {
  try {
    const data = await apiCall('GET', `/api/meetings/${meetingId}`)
    return { is_active: data.is_active || false }
  } catch (error) {
    // If meeting doesn't exist yet (404), treat as inactive
    if (error.message.includes('404') || error.message.includes('not found')) {
      console.log('Meeting not found - treating as inactive')
      return { is_active: false }
    }
    throw error
  }
}

