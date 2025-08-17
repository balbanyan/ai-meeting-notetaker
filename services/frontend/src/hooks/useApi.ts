'use client';

import useSWR from 'swr';
import { useState } from 'react';
import { ApiClient } from '@/lib/api-client';

// Custom hook for API operations with SWR
export function useApi(token?: string) {
  const apiClient = new ApiClient(token);

  return {
    // Health check
    useHealth: () => useSWR('/health', () => apiClient.health()),

    // Meetings
    useMeetings: () => useSWR('/meetings', () => apiClient.getMeetings()),
    
    useMeeting: (id?: string) => useSWR(
      id ? `/meetings/${id}` : null,
      () => id ? apiClient.getMeeting(id) : null
    ),

    // Transcript
    useTranscript: (meetingId?: string, page = 1, limit = 50) => useSWR(
      meetingId ? `/meetings/${meetingId}/transcript?page=${page}&limit=${limit}` : null,
      () => meetingId ? apiClient.getTranscript(meetingId, page, limit) : null
    ),

    // Summary
    useSummary: (meetingId?: string) => useSWR(
      meetingId ? `/meetings/${meetingId}/summary` : null,
      () => meetingId ? apiClient.getSummary(meetingId) : null
    ),

    // API client for mutations
    client: apiClient
  };
}

// Hook for managing loading states and errors
export function useApiMutation() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = async <T>(apiCall: () => Promise<T>): Promise<T | null> => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await apiCall();
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('API call failed');
      setError(error);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { execute, isLoading, error };
}
