import { useState, useEffect } from 'react'
import { registerAndJoinMeeting } from './api/client'

// Funny loading messages
const loadingMessages = [
  "Teaching robot to look busy during long presentations...",
  "AI is learning to distinguish 'let's circle back' from 'no'...",
  "Initializing 'Can you see my screen?' response system...",
  "Activating enterprise-grade note-taking algorithms...",
  "Bot is clearing its virtual throat...",
  "Bot is practicing its 'you're on mute' detection...",
  "Downloading corporate buzzword dictionary...",
  "Bot is joining fashionably late...",
  "Bot is learning the art of the awkward silence...",
  "Bot is learning to interpret 'Let's take this offline'...",
  "AI is learning to smile through technical difficulties...",
  "AI is learning the optimal delay before saying 'Can everyone see my screen?'...",
  "Bot is wondering if this meeting could've been an email...",
  "Teaching bot to say 'Good question' while Googling furiously..."
]

// Get random loading message
const getRandomLoadingMessage = () => {
  return loadingMessages[Math.floor(Math.random() * loadingMessages.length)]
}

function App() {
  const [webexApp, setWebexApp] = useState(null)
  const [meetingData, setMeetingData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [joining, setJoining] = useState(false)
  const [success, setSuccess] = useState(false)
  const [meetingUrl, setMeetingUrl] = useState('')
  const [loadingMessage, setLoadingMessage] = useState('')

  useEffect(() => {
    // Initialize Webex SDK
    const initializeWebex = async () => {
      try {
        // Wait for SDK to be available
        if (!window.webex) {
          console.error('Webex SDK not loaded')
          setError('Webex SDK not loaded. Please refresh the page.')
          setLoading(false)
          return
        }

        const app = new window.webex.Application()
        
        await app.onReady()
        console.log('Webex App ready', app)
        
        setWebexApp(app)
        
        // Get meeting data from SDK using the proper API method
        try {
          const meeting = await app.context.getMeeting()
          console.log('Meeting data:', meeting)
          
          setMeetingData({
            id: meeting.id,
            conferenceId: meeting.conferenceId,
            title: meeting.title,
            // Note: startTime, endTime, meetingType may not be available from SDK
            // Backend will fetch these from Webex API using the meeting ID
          })
          
          setLoading(false)
        } catch (meetingError) {
          console.warn('Could not get meeting data:', meetingError)
          setError('No meeting data available. This app must be run inside a Webex meeting.')
          setLoading(false)
        }
      } catch (err) {
        console.error('Failed to initialize Webex SDK:', err)
        setError(`Failed to initialize: ${err.message}`)
        setLoading(false)
      }
    }

    initializeWebex()
  }, [])

  const handleAddBot = async () => {
    if (!meetingData) {
      setError('No meeting data available')
      return
    }

    if (!meetingUrl || !meetingUrl.trim()) {
      setError('Please enter a meeting URL')
      return
    }

    setLoadingMessage(getRandomLoadingMessage())
    setJoining(true)
    setError(null)
    setSuccess(false)

    // Cycle through messages every 5 seconds
    const messageInterval = setInterval(() => {
      setLoadingMessage(getRandomLoadingMessage())
    }, 5000)

    try {
      // Send meeting data to backend with user-provided URL
      const response = await registerAndJoinMeeting({
        meeting_id: meetingData.id,
        meeting_title: meetingData.title || 'Untitled Meeting',
        start_time: new Date().toISOString(), // Current time as placeholder
        end_time: new Date().toISOString(), // Current time as placeholder
        meeting_type: 'meeting', // Default value
        meeting_url: meetingUrl.trim() // User-provided meeting URL
      })

      console.log('Bot join response:', response)
      setSuccess(true)
      setError(null)
    } catch (err) {
      console.error('Failed to add bot:', err)
      setError(err.message || 'Failed to add bot to meeting')
      setSuccess(false)
    } finally {
      clearInterval(messageInterval)
      setJoining(false)
    }
  }

  const formatDateTime = (dateTime) => {
    if (!dateTime) return 'N/A'
    try {
      return new Date(dateTime).toLocaleString()
    } catch {
      return 'Invalid date'
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Initializing Webex SDK...</p>
        </div>
      </div>
    )
  }

  if (error && !meetingData) {
    return (
      <div className="container">
        <div className="error-card">
          <h2>⚠️ Error</h2>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <header>
        <h1>🤖 AI Meeting Notetaker</h1>
        <p className="tagline">Add intelligent note-taking to your meeting</p>
      </header>

      {meetingData && (
        <div className="meeting-info">
          <h2>Meeting Information</h2>
          <div className="info-grid">
            <div className="info-item">
              <span className="label">Title:</span>
              <span className="value">{meetingData.title || 'Untitled Meeting'}</span>
            </div>
            <div className="info-item">
              <span className="label">Meeting ID:</span>
              <span className="value mono">{meetingData.id}</span>
            </div>
            {meetingData.conferenceId && (
              <div className="info-item">
                <span className="label">Conference ID:</span>
                <span className="value mono">{meetingData.conferenceId}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="action-section">
        <div className="input-group">
          <label htmlFor="meeting-url">Meeting URL</label>
          <input
            id="meeting-url"
            type="text"
            className="meeting-url-input"
            placeholder="https://meet.webex.com/..."
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            disabled={joining || !meetingData}
          />
          <p className="help-text-small">
            Enter the Webex meeting URL to allow the bot to join
          </p>
        </div>

        <button 
          className="primary-button" 
          onClick={handleAddBot}
          disabled={joining || !meetingData || !meetingUrl.trim()}
        >
          {joining ? (
            <>
              <div className="button-spinner"></div>
              {loadingMessage}
            </>
          ) : (
            '🤖 Add Bot to Meeting'
          )}
        </button>

        {success && (
          <div className="success-message">
            ✅ Bot successfully added to meeting! It will join shortly.
          </div>
        )}

        {error && meetingData && (
          <div className="error-message">
            ❌ {error}
          </div>
        )}
      </div>

      <footer>
        <p className="help-text">
          Click the button above to add the AI notetaker bot to this meeting.
          The bot will capture audio and generate transcripts.
        </p>
      </footer>
    </div>
  )
}

export default App

