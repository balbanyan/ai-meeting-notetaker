import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fetchMeetingDetails } from '../api/client'
import { connectToMeeting } from '../api/websocket'
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
  const [activeTab, setActiveTab] = useState('summary') // 'summary' or 'transcript' - will be set based on meeting status
  const [infoCollapsed, setInfoCollapsed] = useState(false)
  const [participantsCollapsed, setParticipantsCollapsed] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const transcriptEndRef = useRef(null)
  const websocketRef = useRef(null)

  useEffect(() => {
    const loadMeetingDetails = async () => {
      try {
        setError(null)
        const response = await fetchMeetingDetails(uuid)
        console.log('Fetched meeting details:', response)
        setMeeting(response)
        
        // For live meetings, default to transcript tab
        if (response.is_active) {
          setActiveTab('transcript')
          setupWebSocket(response)
        }
      } catch (err) {
        console.error('Failed to fetch meeting details:', err)
        setError(err.message || 'Failed to load meeting details')
      } finally {
        setLoading(false)
      }
    }

    loadMeetingDetails()
    
    // Cleanup WebSocket on unmount
    return () => {
      if (websocketRef.current) {
        websocketRef.current.disconnect()
        websocketRef.current = null
      }
    }
  }, [uuid])
  
  const setupWebSocket = (meetingData) => {
    console.log('Setting up WebSocket for live meeting:', uuid)
    
    websocketRef.current = connectToMeeting(uuid, {
      onTranscript: (transcriptData) => {
        console.log('New transcript received:', transcriptData)
        
        // Add new transcript to meeting data (with deduplication)
        setMeeting(prev => {
          if (!prev) return prev
          
          const newTranscript = {
            id: transcriptData.id,
            speaker_name: transcriptData.speaker_name,
            transcript_text: transcriptData.transcript_text,
            start_time: transcriptData.start_time,
            end_time: transcriptData.end_time
          }
          
          // Check if this transcript already exists (by ID)
          const existingTranscripts = prev.transcripts || []
          const isDuplicate = existingTranscripts.some(t => t.id === transcriptData.id)
          
          if (isDuplicate) {
            console.log('Duplicate transcript detected, skipping:', transcriptData.id)
            return prev
          }
          
          return {
            ...prev,
            transcripts: [...existingTranscripts, newTranscript]
          }
        })
        
        // Auto-scroll to new transcript if enabled
        if (autoScroll && activeTab === 'transcript') {
          setTimeout(() => {
            transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
          }, 100)
        }
      },
      onStatus: (statusData) => {
        console.log('Meeting status update:', statusData)
        
        // Update meeting active status
        setMeeting(prev => {
          if (!prev) return prev
          return {
            ...prev,
            is_active: statusData.is_active
          }
        })
        
        // When meeting becomes inactive, enable summary tab (but keep WebSocket for summary)
        if (!statusData.is_active) {
          console.log('Meeting ended - summary tab now available, waiting for summary...')
          // Keep WebSocket open to receive summary
        }
      },
      onSummary: (summaryData) => {
        console.log('Meeting summary received:', summaryData)
        
        // Update meeting with summary
        setMeeting(prev => {
          if (!prev) return prev
          return {
            ...prev,
            meeting_summary: summaryData.summary
          }
        })
        
        // Disconnect WebSocket after receiving summary
        if (websocketRef.current) {
          console.log('Summary received, disconnecting WebSocket')
          websocketRef.current.disconnect()
          websocketRef.current = null
        }
      },
      onDisconnected: () => {
        console.log('WebSocket disconnected')
      }
    })
  }
  
  // Auto-scroll effect when new transcripts arrive
  useEffect(() => {
    if (autoScroll && activeTab === 'transcript' && meeting?.transcripts?.length > 0) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [meeting?.transcripts?.length, autoScroll, activeTab])

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
            <h1 className="meeting-title">
              {getMeetingTitle()}
              {meeting.is_active && <span className="meeting-live-badge-large">LIVE</span>}
            </h1>
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
              className={`tab ${activeTab === 'summary' ? 'active' : ''} ${meeting.is_active ? 'tab-disabled' : ''}`}
              onClick={() => !meeting.is_active && setActiveTab('summary')}
              disabled={meeting.is_active}
              title={meeting.is_active ? 'Summary will be available after the meeting ends' : 'View meeting summary'}
            >
              <MdDescription className="tab-icon" />
              Summary
              {meeting.is_active && <span className="live-indicator-small">LIVE</span>}
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
                {meeting.is_active && (
                  <div className="live-controls">
                    <label className="auto-scroll-toggle">
                      <input 
                        type="checkbox" 
                        checked={autoScroll} 
                        onChange={(e) => setAutoScroll(e.target.checked)}
                      />
                      <span>Auto-scroll to new transcripts</span>
                    </label>
                  </div>
                )}
                
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
                    <div ref={transcriptEndRef} />
                  </div>
                ) : (
                  <div className="empty-state">
                    <MdChat className="empty-icon" />
                    <h3>No Transcript Available</h3>
                    <p>{meeting.is_active ? 'Waiting for transcripts...' : 'This meeting doesn\'t have any transcripts yet.'}</p>
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

