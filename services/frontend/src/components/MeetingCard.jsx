import { useNavigate } from 'react-router-dom'
import { MdArrowForward } from 'react-icons/md'
import '../styles/MeetingCard.css'

function MeetingCard({ meeting }) {
  const navigate = useNavigate()

  const formatDateTime = (dateTime) => {
    if (!dateTime) return 'N/A'
    try {
      const date = new Date(dateTime)
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return 'Invalid date'
    }
  }

  const getTotalParticipants = () => {
    const participants = meeting.participant_emails?.length || 0
    const cohosts = meeting.cohost_emails?.length || 0
    const host = meeting.host_email ? 1 : 0
    return participants + cohosts + host
  }

  const getMeetingTitle = () => {
    // Prioritize: meeting_title > meeting_number > webex_meeting_id
    if (meeting.meeting_title) {
      return meeting.meeting_title
    }
    if (meeting.meeting_number) {
      return `Meeting ${meeting.meeting_number}`
    }
    return meeting.webex_meeting_id?.substring(0, 12) || 'Untitled Meeting'
  }

  const handleClick = () => {
    navigate(`/meeting/${meeting.meeting_uuid}`)
  }

  return (
    <div className="meeting-card" onClick={handleClick}>
      <div className="meeting-card-header">
        <h3 className="meeting-card-title">{getMeetingTitle()}</h3>
        <span className="meeting-card-badge">
          {getTotalParticipants()} participant{getTotalParticipants() !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="meeting-card-body">
        <div className="meeting-card-info">
          <span className="meeting-card-label">Host:</span>
          <span className="meeting-card-value">{meeting.host_email || 'Unknown'}</span>
        </div>

        <div className="meeting-card-info">
          <span className="meeting-card-label">Date:</span>
          <span className="meeting-card-value">
            {formatDateTime(meeting.actual_join_time || meeting.scheduled_start_time)}
          </span>
        </div>

        {meeting.meeting_summary && (
          <div className="meeting-card-summary">
            <span className="meeting-card-label">Summary:</span>
            <p className="meeting-card-summary-text">
              {meeting.meeting_summary.substring(0, 100)}
              {meeting.meeting_summary.length > 100 ? '...' : ''}
            </p>
          </div>
        )}
      </div>

      <div className="meeting-card-footer">
        <span className="meeting-card-link">
          View Details <MdArrowForward />
        </span>
      </div>
    </div>
  )
}

export default MeetingCard

