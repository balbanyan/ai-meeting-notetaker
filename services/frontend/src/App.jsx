import { useState, useEffect } from 'react'
import { registerAndJoinMeeting } from './api/client'

function App() {
  const [webexApp, setWebexApp] = useState(null)
  const [meetingData, setMeetingData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [joining, setJoining] = useState(false)
  const [success, setSuccess] = useState(false)

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
        
        // Get meeting data from SDK
        const meeting = app.context?.meeting
        
        if (meeting) {
          console.log('Meeting data:', meeting)
          setMeetingData({
            id: meeting.id,
            title: meeting.title,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
            meetingType: meeting.meetingType
          })
        } else {
          console.warn('No meeting data available')
          setError('No meeting data available. This app must be run inside a Webex meeting.')
        }
        
        setLoading(false)
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

    setJoining(true)
    setError(null)
    setSuccess(false)

    try {
      // Get the current meeting URL
      // Note: SDK doesn't provide meeting URL directly, we'll need to construct it or get it another way
      // For now, we'll pass the meeting ID and let backend handle it
      const response = await registerAndJoinMeeting({
        meeting_id: meetingData.id,
        meeting_title: meetingData.title || 'Untitled Meeting',
        start_time: meetingData.startTime || new Date().toISOString(),
        end_time: meetingData.endTime || new Date().toISOString(),
        meeting_type: meetingData.meetingType || 'meeting',
        meeting_url: `webex://meeting/${meetingData.id}` // Placeholder URL
      })

      console.log('Bot join response:', response)
      setSuccess(true)
      setError(null)
    } catch (err) {
      console.error('Failed to add bot:', err)
      setError(err.message || 'Failed to add bot to meeting')
      setSuccess(false)
    } finally {
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
            <div className="info-item">
              <span className="label">Type:</span>
              <span className="value">{meetingData.meetingType || 'N/A'}</span>
            </div>
            <div className="info-item">
              <span className="label">Start Time:</span>
              <span className="value">{formatDateTime(meetingData.startTime)}</span>
            </div>
            <div className="info-item">
              <span className="label">End Time:</span>
              <span className="value">{formatDateTime(meetingData.endTime)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="action-section">
        <button 
          className="primary-button" 
          onClick={handleAddBot}
          disabled={joining || !meetingData}
        >
          {joining ? (
            <>
              <div className="button-spinner"></div>
              Adding Bot...
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

