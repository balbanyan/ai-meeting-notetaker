import { useState, useEffect } from 'react'
import { fetchMeetings } from '../api/client'
import MeetingCard from '../components/MeetingCard'
import { MdRefresh, MdEventNote } from 'react-icons/md'
import '../styles/HomePage.css'

function HomePage() {
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadMeetings = async () => {
    try {
      setError(null)
      const response = await fetchMeetings()
      console.log('Fetched meetings:', response)
      setMeetings(response.meetings || [])
    } catch (err) {
      console.error('Failed to fetch meetings:', err)
      setError(err.message || 'Failed to load meetings')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadMeetings()
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
        <h2 className="meetings-title">Completed Meetings</h2>
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
          <h3>No completed meetings yet</h3>
          <p>Meetings will appear here after the bot has joined and left a meeting.</p>
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

