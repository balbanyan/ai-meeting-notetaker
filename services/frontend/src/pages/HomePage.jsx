import { useState, useEffect, useRef } from 'react'
import { fetchMeetings } from '../api/client'
import { connectToMeeting } from '../api/websocket'
import MeetingCard from '../components/MeetingCard'
import { MdRefresh, MdEventNote } from 'react-icons/md'
import '../styles/HomePage.css'

function HomePage() {
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const websocketConnections = useRef(new Map())

  const loadMeetings = async () => {
    try {
      setError(null)
      const response = await fetchMeetings()
      console.log('Fetched meetings:', response)
      setMeetings(response.meetings || [])
      
      // Setup WebSocket connections for live meetings
      setupWebSocketConnections(response.meetings || [])
    } catch (err) {
      console.error('Failed to fetch meetings:', err)
      setError(err.message || 'Failed to load meetings')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const setupWebSocketConnections = (meetingsList) => {
    // Get live meetings
    const liveMeetings = meetingsList.filter(m => m.is_active)
    
    // Clean up connections for meetings no longer live
    websocketConnections.current.forEach((ws, meetingId) => {
      const isStillLive = liveMeetings.some(m => m.meeting_uuid === meetingId)
      if (!isStillLive) {
        console.log(`Disconnecting WebSocket for inactive meeting: ${meetingId}`)
        ws.disconnect()
        websocketConnections.current.delete(meetingId)
      }
    })
    
    // Setup connections for new live meetings
    liveMeetings.forEach(meeting => {
      const meetingId = meeting.meeting_uuid
      
      // Skip if already connected
      if (websocketConnections.current.has(meetingId)) {
        return
      }
      
      console.log(`Setting up WebSocket for live meeting: ${meetingId}`)
      
      const ws = connectToMeeting(meetingId, {
        onStatus: (data) => {
          console.log('Meeting status update:', data)
          // Refresh meetings list when status changes
          loadMeetings()
        },
        onTranscript: (data) => {
          console.log('New transcript received:', data)
          // Could update transcript count here if needed
        },
        onDisconnected: () => {
          console.log(`WebSocket disconnected for meeting: ${meetingId}`)
        }
      })
      
      websocketConnections.current.set(meetingId, ws)
    })
  }

  useEffect(() => {
    loadMeetings()
    
    // Cleanup WebSocket connections on unmount
    return () => {
      websocketConnections.current.forEach(ws => ws.disconnect())
      websocketConnections.current.clear()
    }
  }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    loadMeetings()
  }

  if (loading) {
    return (
      <div className="home-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading meetings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="home-container">
      <header className="home-header">
        <h1>AI Space Notetaker</h1>
        <p className="tagline">Your meeting transcripts and summaries</p>
      </header>

      <div className="home-toolbar">
        <h2 className="meetings-title">
          Meetings
          {meetings.filter(m => m.is_active).length > 0 && (
            <span className="live-count-badge">
              {meetings.filter(m => m.is_active).length} Live
            </span>
          )}
        </h2>
        <button 
          className="refresh-button" 
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <>
              <div className="button-spinner-small"></div>
              Refreshing...
            </>
          ) : (
            <>
              <MdRefresh /> Refresh
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {!error && meetings.length === 0 && (
        <div className="empty-state">
          <MdEventNote className="empty-state-icon" />
          <h3>No meetings yet</h3>
          <p>Meetings will appear here when the bot joins a meeting.</p>
        </div>
      )}

      {!error && meetings.length > 0 && (
        <div className="meetings-grid">
          {meetings.map((meeting) => (
            <MeetingCard key={meeting.meeting_uuid} meeting={meeting} />
          ))}
        </div>
      )}
    </div>
  )
}

export default HomePage

