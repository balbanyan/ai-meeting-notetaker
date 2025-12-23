import { useState, useEffect, useRef } from 'react'
import { registerAndJoinMeeting, getMeetingStatus } from '../api/client'
import { connectToMeetingStatus } from '../api/websocket'
import Logo3D from '../assets/images/3DLogo.svg'

// Loading messages
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

const getRandomLoadingMessage = () => {
  return loadingMessages[Math.floor(Math.random() * loadingMessages.length)]
}

// Icons
const LockIcon = () => (
  <svg className="radio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
)

const UsersIcon = () => (
  <svg className="radio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)

const SparklesIcon = () => (
  <svg className="button-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    <path d="M5 3v4"/>
    <path d="M19 17v4"/>
    <path d="M3 5h4"/>
    <path d="M17 19h4"/>
  </svg>
)

const CheckCircleIcon = () => (
  <svg className="status-icon status-icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="m9 12 2 2 4-4"/>
  </svg>
)

const AlertCircleIcon = () => (
  <svg className="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" x2="12" y1="8" y2="12"/>
    <line x1="12" x2="12.01" y1="16" y2="16"/>
  </svg>
)

function EmbeddedApp() {
  const isDev = import.meta.env.VITE_DEV_MODE === 'false'
  
  const [meetingData, setMeetingData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [joining, setJoining] = useState(false)
  const [success, setSuccess] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [isBotActive, setIsBotActive] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [classification, setClassification] = useState(null)
  const [manualMeetingId, setManualMeetingId] = useState('')
  const websocketRef = useRef(null)

  useEffect(() => {
    if (isDev) {
      console.log('Running in DEV MODE - Webex SDK disabled')
      setMeetingData({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        conferenceId: 'CONF-98765',
        title: 'Weekly Team Sync'
      })
      setLoading(false)
      setCheckingStatus(false)
      return
    }
    
    const initializeWebex = async () => {
      try {
        if (!window.webex) {
          console.error('Webex SDK not loaded')
          setError('Webex SDK not loaded. Please refresh the page.')
          setLoading(false)
          setCheckingStatus(false)
          return
        }

        const app = new window.webex.Application()
        await app.onReady()
        console.log('Webex App ready', app)
        
        try {
          const meeting = await app.context.getMeeting()
          console.log('Meeting data:', meeting)
          
          setMeetingData({
            id: meeting.id,
            conferenceId: meeting.conferenceId,
            title: meeting.title,
          })
          
          setupWebSocket(meeting.id)
          setLoading(false)
        } catch (meetingError) {
          console.warn('Could not get meeting data:', meetingError)
          setError('No meeting data available. This app must be run inside a Webex meeting.')
          setLoading(false)
          setCheckingStatus(false)
        }
      } catch (err) {
        console.error('Failed to initialize Webex SDK:', err)
        setError(`Failed to initialize: ${err.message}`)
        setLoading(false)
        setCheckingStatus(false)
      }
    }

    initializeWebex()
    
    return () => {
      if (websocketRef.current) {
        websocketRef.current.disconnect()
        websocketRef.current = null
      }
    }
  }, [isDev])
  
  const setupWebSocket = async (meetingId) => {
    try {
      const statusData = await getMeetingStatus(meetingId)
      setIsBotActive(statusData.is_active)
    } catch (err) {
      console.warn('Could not fetch initial meeting status:', err)
    } finally {
      setCheckingStatus(false)
    }
    
    websocketRef.current = connectToMeetingStatus(meetingId, (isActive) => {
      setIsBotActive(isActive)
      if (isActive && joining) {
        setSuccess(true)
        setJoining(false)
      }
    })
  }

  const handleAddBot = async () => {
    const meetingId = isDev ? (manualMeetingId || meetingData?.id) : meetingData?.id
    
    if (!meetingId) {
      setError('No meeting data available')
      return
    }

    setLoadingMessage(getRandomLoadingMessage())
    setJoining(true)
    setError(null)
    setSuccess(false)

    const messageInterval = setInterval(() => {
      setLoadingMessage(getRandomLoadingMessage())
    }, 5000)

    try {
      if (isDev) {
        // Simulate join in dev mode
        await new Promise(resolve => setTimeout(resolve, 15000))
        console.log('Bot join simulated for meeting:', meetingId)
      } else {
        const response = await registerAndJoinMeeting({ 
          meeting_id: meetingId,
          classification: classification  // Pass selected classification (private or shared)
        })
        console.log('Bot join response:', response)
      }
      setSuccess(true)
      setIsBotActive(true)
    } catch (err) {
      console.error('Failed to add bot:', err)
      setError(err.message || 'Failed to add bot to meeting')
    } finally {
      clearInterval(messageInterval)
      setJoining(false)
    }
  }

  // Loading screen
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-spinner"></div>
          <p className="loading-text">Initializing Webex SDK...</p>
        </div>
      </div>
    )
  }

  // Error screen (only if no meeting data)
  if (error && !meetingData && !isDev) {
    return (
      <div className="error-screen">
        <div className="card error-card">
          <div className="error-content">
            <AlertCircleIcon />
            <div>
              <h2 className="error-title">Connection Error</h2>
              <p className="error-message">{error}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      {isDev && <div className="dev-badge">Dev Mode</div>}
      
      <div className="app-content">
        {/* Header */}
        <header className="app-header">
          <img src={Logo3D} alt="AI Space" className="header-logo" />
          <span className="header-title">Notetaker</span>
        </header>

        {/* Meeting Card */}
        {meetingData && (
          <div className="card">
            <div className="meeting-card-content">
              <div className="meeting-card-header">
                <div className="meeting-card-info">
                  <p className="meeting-label">Current Meeting</p>
                  <h2 className="meeting-title">
                    {meetingData.title || 'Untitled Meeting'}
                  </h2>
                </div>
                
                {checkingStatus ? (
                  <div className="badge badge-secondary">
                    <span className="badge-spinner"></span>
                    Checking
                  </div>
                ) : isBotActive ? (
                  <div className="badge badge-primary">
                    <span className="badge-dot"></span>
                    Bot Active
                  </div>
                ) : null}
              </div>
              
              <div className="meeting-footer-section">
                <hr className="meeting-divider" />
                <div className="meeting-id-footer">
                  {isDev ? (
                    <input
                      type="text"
                      className="meeting-id-input"
                      placeholder="ID: Enter meeting ID to override..."
                      value={manualMeetingId}
                      onChange={(e) => setManualMeetingId(e.target.value)}
                      disabled={joining}
                    />
                  ) : (
                    <p className="meeting-id-text">
                      ID: {meetingData.id}
                      {meetingData.conferenceId && ` / ${meetingData.conferenceId}`}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Classification Card */}
        <div className="card">
          <div className="classification-content">
            <div className="classification-header">
              <label className="classification-title">
                Meeting Classification <span className="classification-required">*</span>
              </label>
              <p className="classification-description">
                Choose who can access the meeting notes
              </p>
            </div>
            
            <div className={`radio-group ${(isBotActive || joining) ? 'disabled' : ''}`}>
              <div 
                className={`radio-option ${classification === 'private' ? 'selected' : ''} ${(isBotActive || joining) ? 'disabled' : ''}`}
                onClick={() => !(isBotActive || joining) && setClassification('private')}
              >
                <div className="radio-circle">
                  <div className="radio-dot"></div>
                </div>
                <div className="radio-content">
                  <div className="radio-label-row">
                    <LockIcon />
                    <span className="radio-label">Private</span>
                  </div>
                  <p className="radio-sublabel">Only the host can access notes</p>
                </div>
              </div>
              
              <div 
                className={`radio-option ${classification === 'shared' ? 'selected' : ''} ${(isBotActive || joining) ? 'disabled' : ''}`}
                onClick={() => !(isBotActive || joining) && setClassification('shared')}
              >
                <div className="radio-circle">
                  <div className="radio-dot"></div>
                </div>
                <div className="radio-content">
                  <div className="radio-label-row">
                    <UsersIcon />
                    <span className="radio-label">Shared</span>
                  </div>
                  <p className="radio-sublabel">All participants can access notes</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Section */}
        <div className="action-section">
          <button 
            className="primary-button"
            onClick={handleAddBot}
            disabled={joining || !meetingData || isBotActive || !classification}
          >
            {joining ? (
              <>
                <span className="button-spinner"></span>
                <span className="button-text">{loadingMessage}</span>
              </>
            ) : isBotActive ? (
              <>
                <CheckCircleIcon />
                <span>Bot Already Active</span>
              </>
            ) : (
              <>
                <SparklesIcon />
                <span>Add Bot to Meeting</span>
              </>
            )}
          </button>

          {success && !isBotActive && (
            <div className="status-message status-success">
              <CheckCircleIcon />
              <p>Bot successfully added! It will join shortly.</p>
            </div>
          )}

          {error && (
            <div className="status-message status-error">
              <AlertCircleIcon />
              <p>{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="app-footer">
          <p className="footer-text">
            The AI notetaker will join your meeting, capture audio, and generate transcripts automatically.
          </p>
        </footer>
      </div>
    </div>
  )
}

export default EmbeddedApp
