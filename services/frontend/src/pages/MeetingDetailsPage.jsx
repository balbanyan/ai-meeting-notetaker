import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fetchMeetingDetails } from '../api/client'
import { 
  MdInfoOutline, 
  MdPeople, 
  MdDescription, 
  MdChat,
  MdArrowBack,
  MdExpandLess,
  MdExpandMore
} from 'react-icons/md'
import '../styles/MeetingDetailsPage.css'

function MeetingDetailsPage() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  
  const [meeting, setMeeting] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('summary') // 'summary' or 'transcript'
  const [infoCollapsed, setInfoCollapsed] = useState(false)
  const [participantsCollapsed, setParticipantsCollapsed] = useState(false)

  useEffect(() => {
    const loadMeetingDetails = async () => {
      try {
        setError(null)
        const response = await fetchMeetingDetails(uuid)
        console.log('Fetched meeting details:', response)
        setMeeting(response)
      } catch (err) {
        console.error('Failed to fetch meeting details:', err)
        setError(err.message || 'Failed to load meeting details')
      } finally {
        setLoading(false)
      }
    }

    loadMeetingDetails()
  }, [uuid])

  const formatDateTime = (dateTime) => {
    if (!dateTime) return 'N/A'
    try {
      const date = new Date(dateTime)
      return date.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return 'Invalid date'
    }
  }

  const formatTime = (dateTime) => {
    if (!dateTime) return 'N/A'
    try {
      const date = new Date(dateTime)
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    } catch {
      return 'Invalid time'
    }
  }

  const getMeetingTitle = () => {
    if (!meeting) return 'Meeting Details'
    // Prioritize: meeting_title > meeting_number > webex_meeting_id
    if (meeting.meeting_title) {
      return meeting.meeting_title
    }
    if (meeting.meeting_number) {
      return `Meeting ${meeting.meeting_number}`
    }
    return meeting.webex_meeting_id?.substring(0, 12) || 'Untitled Meeting'
  }

  if (loading) {
    return (
      <div className="details-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading meeting details...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="details-container">
        <button className="back-button" onClick={() => navigate('/')}>
          <MdArrowBack /> Back to Meetings
        </button>
        <div className="error-card">
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="details-container">
        <button className="back-button" onClick={() => navigate('/')}>
          <MdArrowBack /> Back to Meetings
        </button>
        <div className="error-card">
          <h2>Meeting Not Found</h2>
          <p>The requested meeting could not be found.</p>
        </div>
      </div>
    )
  }

  // Helper to get speaker color
  const getSpeakerColor = (speakerName) => {
    const colors = [
      '#60BC94', '#F4FCA8', '#00604C', '#82C9A5', '#D4EAE0'
    ]
    let hash = 0
    for (let i = 0; i < speakerName.length; i++) {
      hash = speakerName.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }

  // Group consecutive messages from same speaker
  const groupTranscripts = (transcripts) => {
    if (!transcripts || transcripts.length === 0) return []
    
    const grouped = []
    let currentGroup = null
    
    transcripts.forEach((transcript) => {
      if (!currentGroup || currentGroup.speaker !== transcript.speaker_name) {
        if (currentGroup) grouped.push(currentGroup)
        currentGroup = {
          speaker: transcript.speaker_name || 'Unknown Speaker',
          messages: [transcript],
          startTime: transcript.start_time
        }
      } else {
        currentGroup.messages.push(transcript)
      }
    })
    
    if (currentGroup) grouped.push(currentGroup)
    return grouped
  }

  return (
    <div className="details-container">
      <button className="back-button" onClick={() => navigate('/')}>
        <MdArrowBack /> Back to Meetings
      </button>

      <div className="details-layout">
        {/* Sidebar */}
        <aside className="details-sidebar">
          <header className="sidebar-header">
            <h1 className="meeting-title">{getMeetingTitle()}</h1>
            <p className="meeting-date">
              {formatDateTime(meeting.actual_join_time || meeting.scheduled_start_time)}
            </p>
          </header>

          {/* Meeting Information Section */}
          <section className="sidebar-section">
            <div className="section-header" onClick={() => setInfoCollapsed(!infoCollapsed)}>
              <h2 className="section-title">
                <MdInfoOutline className="section-icon" />
                Meeting Info
              </h2>
              <span className="collapse-icon">
                {infoCollapsed ? <MdExpandMore /> : <MdExpandLess />}
              </span>
            </div>
            
            {!infoCollapsed && (
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">Host</span>
                  <span className="info-value">{meeting.host_email || 'Unknown'}</span>
                </div>
                
                {meeting.meeting_number && (
                  <div className="info-item">
                    <span className="info-label">Meeting #</span>
                    <span className="info-value">{meeting.meeting_number}</span>
                  </div>
                )}

                <div className="info-item">
                  <span className="info-label">Meeting ID</span>
                  <span className="info-value mono">{meeting.webex_meeting_id}</span>
                </div>

                {meeting.scheduled_start_time && (
                  <div className="info-item">
                    <span className="info-label">Scheduled</span>
                    <span className="info-value">{formatDateTime(meeting.scheduled_start_time)}</span>
                  </div>
                )}

                {meeting.actual_join_time && (
                  <div className="info-item">
                    <span className="info-label">Bot Joined</span>
                    <span className="info-value">{formatTime(meeting.actual_join_time)}</span>
                  </div>
                )}

                {meeting.actual_leave_time && (
                  <div className="info-item">
                    <span className="info-label">Bot Left</span>
                    <span className="info-value">{formatTime(meeting.actual_leave_time)}</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Participants Section */}
          <section className="sidebar-section">
            <div className="section-header" onClick={() => setParticipantsCollapsed(!participantsCollapsed)}>
              <h2 className="section-title">
                <MdPeople className="section-icon" />
                Participants
                {(() => {
                  const count = (meeting.host_email ? 1 : 0) + 
                                (meeting.cohost_emails?.length || 0) + 
                                (meeting.participant_emails?.length || 0)
                  return count > 0 ? <span className="count-badge">{count}</span> : null
                })()}
              </h2>
              <span className="collapse-icon">
                {participantsCollapsed ? <MdExpandMore /> : <MdExpandLess />}
              </span>
            </div>
            
            {!participantsCollapsed && (() => {
              // Combine all participants: host, cohosts, and regular participants
              const allParticipants = []
              
              // Add host
              if (meeting.host_email) {
                allParticipants.push({ email: meeting.host_email, role: 'Host' })
              }
              
              // Add cohosts
              if (meeting.cohost_emails && meeting.cohost_emails.length > 0) {
                meeting.cohost_emails.forEach(email => {
                  allParticipants.push({ email, role: 'Co-host' })
                })
              }
              
              // Add regular participants
              if (meeting.participant_emails && meeting.participant_emails.length > 0) {
                meeting.participant_emails.forEach(email => {
                  allParticipants.push({ email, role: 'Participant' })
                })
              }
              
              if (allParticipants.length === 0) {
                return <p className="no-data">No participants</p>
              }
              
              return (
                <ul className="participants-list">
                  {allParticipants.map((participant, index) => (
                    <li key={index} className="participant-item">
                      <div 
                        className="participant-avatar" 
                        style={{ backgroundColor: getSpeakerColor(participant.email) }}
                      >
                        {participant.email.charAt(0).toUpperCase()}
                      </div>
                      <div className="participant-info">
                        <span className="participant-email">{participant.email}</span>
                        <span className="participant-role">{participant.role}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            })()}
          </section>
        </aside>

        {/* Main Content Area */}
        <main className="details-main">
          {/* Tabs */}
          <div className="tabs-container">
            <button 
              className={`tab ${activeTab === 'summary' ? 'active' : ''}`}
              onClick={() => setActiveTab('summary')}
            >
              <MdDescription className="tab-icon" />
              Summary
            </button>
            <button 
              className={`tab ${activeTab === 'transcript' ? 'active' : ''}`}
              onClick={() => setActiveTab('transcript')}
            >
              <MdChat className="tab-icon" />
              Transcript
              {meeting.transcripts && meeting.transcripts.length > 0 && (
                <span className="count-badge">{meeting.transcripts.length}</span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            {activeTab === 'summary' && (
              <div className="summary-view">
                {meeting.meeting_summary ? (
                  <div className="summary-card">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {meeting.meeting_summary}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="empty-state">
                    <MdDescription className="empty-icon" />
                    <h3>No Summary Available</h3>
                    <p>This meeting doesn't have a summary yet.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'transcript' && (
              <div className="transcript-view">
                {meeting.transcripts && meeting.transcripts.length > 0 ? (
                  <div className="conversation">
                    {groupTranscripts(meeting.transcripts).map((group, groupIndex) => (
                      <div key={groupIndex} className="message-group">
                        <div className="message-header">
                          <div 
                            className="speaker-avatar" 
                            style={{ backgroundColor: getSpeakerColor(group.speaker) }}
                          >
                            {group.speaker.charAt(0).toUpperCase()}
                          </div>
                          <div className="speaker-info">
                            <span className="speaker-name">{group.speaker}</span>
                            <span className="message-time">{formatTime(group.startTime)}</span>
                          </div>
                        </div>
                        <div className="message-content">
                          {group.messages.map((msg, msgIndex) => (
                            <p key={msgIndex} className="message-text">
                              {msg.transcript_text}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <MdChat className="empty-icon" />
                    <h3>No Transcript Available</h3>
                    <p>This meeting doesn't have any transcripts yet.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

export default MeetingDetailsPage

