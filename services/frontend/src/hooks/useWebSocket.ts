'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseWebSocketOptions {
  url?: string;
  meetingId?: string;
  onTranscriptUpdate?: (segment: any) => void;
  onError?: (error: Error) => void;
  autoConnect?: boolean;
}

export function useWebSocket({
  url = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000',
  meetingId,
  onTranscriptUpdate,
  onError,
  autoConnect = true
}: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) {
      return;
    }

    try {
      const socket = io(url, {
        transports: ['websocket'],
        autoConnect: false
      });

      socket.on('connect', () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setError(null);
        
        // Join meeting room if meetingId is provided
        if (meetingId) {
          socket.emit('join_meeting', { meeting_id: meetingId });
        }
      });

      socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
      });

      socket.on('connect_error', (err) => {
        console.error('WebSocket connection error:', err);
        const error = new Error(`WebSocket connection failed: ${err.message}`);
        setError(error);
        onError?.(error);
      });

      // Listen for transcript updates
      socket.on('transcript_update', (data) => {
        console.log('Received transcript update:', data);
        onTranscriptUpdate?.(data);
      });

      // Listen for meeting events
      socket.on('meeting_started', (data) => {
        console.log('Meeting started:', data);
      });

      socket.on('meeting_ended', (data) => {
        console.log('Meeting ended:', data);
      });

      socketRef.current = socket;
      socket.connect();
      
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create WebSocket connection');
      setError(error);
      onError?.(error);
    }
  }, [url, meetingId, onTranscriptUpdate, onError]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, []);

  const joinMeeting = useCallback((newMeetingId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('join_meeting', { meeting_id: newMeetingId });
    }
  }, []);

  const leaveMeeting = useCallback((meetingIdToLeave: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('leave_meeting', { meeting_id: meetingIdToLeave });
    }
  }, []);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  return {
    isConnected,
    error,
    connect,
    disconnect,
    joinMeeting,
    leaveMeeting,
    socket: socketRef.current
  };
}
