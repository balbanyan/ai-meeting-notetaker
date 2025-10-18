// API client for backend communication

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

/**
 * Register meeting and trigger bot join
 * @param {Object} meetingData - Meeting data from Webex SDK
 * @returns {Promise<Object>} Response from backend
 */
export async function registerAndJoinMeeting(meetingData) {
  const response = await fetch(`${BACKEND_URL}/embedded/register-and-join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(meetingData),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(error.detail || `HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json()
}

