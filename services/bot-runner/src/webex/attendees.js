const axios = require('axios');
const { createLogger } = require('../utils/logger');

const logger = createLogger('WebexAttendees');

class WebexAttendeesAPI {
  constructor(webex) {
    this.webex = webex;
    this.baseUrl = 'https://webexapis.com/v1';
  }

  /**
   * Get authorization headers for Webex REST API calls
   */
  getAuthHeaders() {
    const accessToken = this.webex.credentials.authorization.access_token;
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get meeting participants using Webex REST API
   * https://developer.webex.com/meeting/docs/api/v1/meeting-participants/list-meeting-participants
   */
  async getMeetingParticipants(meetingId) {
    try {
      logger.info(`Fetching participants for meeting: ${meetingId}`);
      
      const response = await axios.get(
        `${this.baseUrl}/meetingParticipants`,
        {
          headers: this.getAuthHeaders(),
          params: {
            meetingId: meetingId
          }
        }
      );
      
      const participants = response.data.items || [];
      logger.info(`Found ${participants.length} participants`);
      
      // Extract email addresses and names
      const attendees = participants.map(participant => ({
        id: participant.id,
        email: participant.email,
        displayName: participant.displayName,
        hostKey: participant.hostKey || false,
        coHost: participant.coHost || false,
        status: participant.status
      })).filter(attendee => attendee.email); // Only include participants with emails
      
      logger.info(`Extracted ${attendees.length} attendees with emails`);
      return attendees;
      
    } catch (error) {
      logger.error(`Failed to fetch meeting participants for ${meetingId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get meeting invitees using Webex REST API  
   * https://developer.webex.com/meeting/docs/api/v1/meeting-invitees/list-meeting-invitees
   */
  async getMeetingInvitees(meetingId) {
    try {
      logger.info(`Fetching invitees for meeting: ${meetingId}`);
      
      const response = await axios.get(
        `${this.baseUrl}/meetingInvitees`,
        {
          headers: this.getAuthHeaders(),
          params: {
            meetingId: meetingId
          }
        }
      );
      
      const invitees = response.data.items || [];
      logger.info(`Found ${invitees.length} invitees`);
      
      // Extract email addresses and names
      const attendees = invitees.map(invitee => ({
        id: invitee.id,
        email: invitee.email,
        displayName: invitee.displayName,
        hostKey: invitee.hostKey || false,
        coHost: invitee.coHost || false,
        panelist: invitee.panelist || false
      })).filter(attendee => attendee.email); // Only include invitees with emails
      
      logger.info(`Extracted ${attendees.length} invitees with emails`);
      return attendees;
      
    } catch (error) {
      logger.error(`Failed to fetch meeting invitees for ${meetingId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get comprehensive attendee list by combining participants and invitees
   */
  async getComprehensiveAttendeeList(meetingId) {
    try {
      logger.info(`Getting comprehensive attendee list for meeting: ${meetingId}`);
      
      // Try to get both participants and invitees
      const [participantsResult, inviteesResult] = await Promise.allSettled([
        this.getMeetingParticipants(meetingId),
        this.getMeetingInvitees(meetingId)
      ]);
      
      let allAttendees = [];
      
      // Process participants result
      if (participantsResult.status === 'fulfilled') {
        allAttendees.push(...participantsResult.value);
        logger.info(`Added ${participantsResult.value.length} participants`);
      } else {
        logger.warn('Failed to fetch participants:', participantsResult.reason.message);
      }
      
      // Process invitees result
      if (inviteesResult.status === 'fulfilled') {
        // Merge invitees, avoiding duplicates based on email
        const existingEmails = new Set(allAttendees.map(a => a.email));
        const newInvitees = inviteesResult.value.filter(i => !existingEmails.has(i.email));
        allAttendees.push(...newInvitees);
        logger.info(`Added ${newInvitees.length} additional invitees`);
      } else {
        logger.warn('Failed to fetch invitees:', inviteesResult.reason.message);
      }
      
      // Remove duplicates based on email (just in case)
      const uniqueAttendees = allAttendees.reduce((acc, current) => {
        const existing = acc.find(item => item.email === current.email);
        if (!existing) {
          acc.push(current);
        } else {
          // Merge properties, preferring participant data over invitee data
          Object.assign(existing, current);
        }
        return acc;
      }, []);
      
      logger.info(`Final attendee list: ${uniqueAttendees.length} unique attendees`);
      return uniqueAttendees;
      
    } catch (error) {
      logger.error(`Failed to get comprehensive attendee list for ${meetingId}:`, error);
      throw error;
    }
  }
}

module.exports = { WebexAttendeesAPI };
