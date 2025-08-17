'use client';

import { useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { MicrophoneIcon } from '@heroicons/react/24/outline';

interface TranscriptSegment {
  id: string;
  content: string;
  start_ms: number;
  end_ms: number;
  created_at: string;
  speaker?: string;
}

interface LiveTranscriptProps {
  segments: TranscriptSegment[];
  isLive: boolean;
  isLoading: boolean;
  error: any;
}

export function LiveTranscript({ segments, isLive, isLoading, error }: LiveTranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new segments arrive
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [segments]);

  const formatTimestamp = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-2">Failed to load transcript</div>
        <div className="text-sm text-gray-500">{error.message}</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-webex-600 mx-auto mb-2"></div>
        <div className="text-sm text-gray-500">Loading transcript...</div>
      </div>
    );
  }

  if (!segments || segments.length === 0) {
    return (
      <div className="text-center py-12">
        <MicrophoneIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          {isLive ? 'Waiting for audio...' : 'No transcript available'}
        </h3>
        <p className="text-sm text-gray-500">
          {isLive 
            ? 'The AI bot is listening and will display transcript segments as they are processed.'
            : 'This meeting doesn\'t have any transcript data yet.'
          }
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Live indicator */}
      {isLive && (
        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="h-2 w-2 bg-red-500 rounded-full animate-pulse"></div>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-green-800">
                Live transcription active
              </p>
              <p className="text-sm text-green-700">
                Audio is being processed in real-time
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Transcript segments */}
      <div 
        ref={containerRef}
        className="space-y-4 max-h-96 overflow-y-auto border rounded-lg p-4 bg-gray-50"
      >
        {segments.map((segment, index) => (
          <div
            key={segment.id || index}
            className="bg-white rounded-lg p-4 shadow-sm border"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center space-x-2">
                {segment.speaker && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {segment.speaker}
                  </span>
                )}
                <span className="text-xs text-gray-500 font-mono">
                  {formatTimestamp(segment.start_ms)}
                  {segment.end_ms && ` - ${formatTimestamp(segment.end_ms)}`}
                </span>
              </div>
              <span className="text-xs text-gray-400">
                {format(new Date(segment.created_at), 'HH:mm:ss')}
              </span>
            </div>
            <p className="text-gray-900 leading-relaxed">
              {segment.content}
            </p>
          </div>
        ))}
        
        {/* Auto-scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Transcript info */}
      <div className="text-xs text-gray-500 text-center">
        {segments.length > 0 && (
          <>
            Showing {segments.length} transcript segments
            {isLive && ' • Updates automatically'}
          </>
        )}
      </div>
    </div>
  );
}
