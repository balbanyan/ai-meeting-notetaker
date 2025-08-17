import createClient from 'openapi-fetch';
import type { paths } from './api-types';

// Create the main API client
export const api = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Authenticated API client with token
export function createAuthenticatedClient(token: string) {
  return createClient<paths>({
    baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

// API client methods with better error handling
export class ApiClient {
  private client: ReturnType<typeof createClient<paths>>;

  constructor(token?: string) {
    this.client = token ? createAuthenticatedClient(token) : api;
  }

  // Health check
  async health() {
    const { data, error } = await this.client.GET('/api/v1/health');
    if (error) throw new Error('Health check failed');
    return data;
  }

  // Meeting operations
  async getMeetings() {
    const { data, error } = await this.client.GET('/api/v1/meetings');
    if (error) throw new Error('Failed to fetch meetings');
    return data;
  }

  async getMeeting(id: string) {
    const { data, error } = await this.client.GET('/api/v1/meetings/{meeting_id}', {
      params: { path: { meeting_id: id } }
    });
    if (error) throw new Error('Failed to fetch meeting');
    return data;
  }

  async joinMeeting(meetingData: {
    webex_meeting_id: string;
    title: string;
    host_email: string;
  }) {
    const { data, error } = await this.client.POST('/api/v1/meetings/join', {
      body: meetingData
    });
    if (error) throw new Error('Failed to join meeting');
    return data;
  }

  async leaveMeeting(meetingId: string) {
    const { data, error } = await this.client.POST('/api/v1/meetings/{meeting_id}/leave', {
      params: { path: { meeting_id: meetingId } }
    });
    if (error) throw new Error('Failed to leave meeting');
    return data;
  }

  // Transcript operations
  async getTranscript(meetingId: string, page = 1, limit = 50) {
    const { data, error } = await this.client.GET('/api/v1/meetings/{meeting_id}/transcript', {
      params: {
        path: { meeting_id: meetingId },
        query: { skip: (page - 1) * limit, limit }
      }
    });
    if (error) throw new Error('Failed to fetch transcript');
    return data;
  }

  // Summary operations
  async getSummary(meetingId: string) {
    const { data, error } = await this.client.GET('/api/v1/meetings/{meeting_id}/summary', {
      params: { path: { meeting_id: meetingId } }
    });
    if (error) throw new Error('Failed to fetch summary');
    return data;
  }

  async generateSummary(meetingId: string, summaryType = 'concise') {
    const { data, error } = await this.client.POST('/api/v1/meetings/{meeting_id}/summary:generate', {
      params: { path: { meeting_id: meetingId } },
      body: { summary_type: summaryType } as any
    });
    if (error) throw new Error('Failed to generate summary');
    return data;
  }

  // Chat operations
  async chatWithMeeting(meetingId: string, question: string) {
    const { data, error } = await this.client.POST('/api/v1/chat/rag', {
      body: { question },
      params: { query: { meeting_id: meetingId } }
    });
    if (error) throw new Error('Failed to chat with meeting');
    return data;
  }
}

// Default API client instance
export const apiClient = new ApiClient();
