'use client';

import { useState, useEffect } from 'react';
import { useDevAuth } from '@/components/dev-auth-provider';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Button } from '@/components/ui/button';
import { LiveTranscript } from '@/components/meeting/live-transcript';
import { MeetingSummary } from '@/components/meeting/meeting-summary';
import { ChatBot } from '@/components/meeting/chat-bot';
import { 
  ArrowLeftIcon,
  CalendarIcon,
  UserGroupIcon,
  ClockIcon,
  DocumentTextIcon,
  ChatBubbleLeftIcon
} from '@heroicons/react/24/outline';
import { formatDistanceToNow, format } from 'date-fns';

export default function MeetingPage() {
  const params = useParams();
  const meetingId = params.id as string;
  const { data: session } = useDevAuth();
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary'>('transcript');
  const [transcriptSegments, setTranscriptSegments] = useState<any[]>([]);

  const { useMeeting, useTranscript, useSummary } = useApi(session?.accessToken);
  const { data: meeting, error: meetingError, isLoading: meetingLoading } = useMeeting(meetingId);
  const { data: transcript, error: transcriptError, isLoading: transcriptLoading } = useTranscript(meetingId);
  const { data: summary, error: summaryError, isLoading: summaryLoading } = useSummary(meetingId);

  // WebSocket for live transcript updates
  const { isConnected } = useWebSocket({
    meetingId,
    onTranscriptUpdate: (segment) => {
      setTranscriptSegments(prev => [...prev, segment]);
    },
    autoConnect: true
  });

  useEffect(() => {
    if (transcript) {
      setTranscriptSegments(transcript);
    }
  }, [transcript]);

  if (meetingLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-webex-600"></div>
      </div>
    );
  }

  if (meetingError || !meeting) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Meeting Not Found</h1>
          <p className="text-gray-600 mb-4">The meeting you're looking for doesn't exist or you don't have access to it.</p>
          <Link href="/">
            <Button>
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const startTime = new Date(meeting.start_time);
  const endTime = meeting.end_time ? new Date(meeting.end_time) : null;
  const isActive = meeting.status === 'active';
  const hasEnded = meeting.status === 'ended';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center space-x-4">
              <Link href="/">
                <Button variant="secondary" size="sm">
                  <ArrowLeftIcon className="h-4 w-4 mr-2" />
                  Back
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{meeting.title}</h1>
                <div className="flex items-center space-x-4 mt-1 text-sm text-gray-500">
                  <div className="flex items-center">
                    <CalendarIcon className="h-4 w-4 mr-1" />
                    {format(startTime, 'MMM d, yyyy h:mm a')}
                  </div>
                  {endTime && (
                    <div className="flex items-center">
                      <ClockIcon className="h-4 w-4 mr-1" />
                      {formatDistanceToNow(endTime, { addSuffix: true })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  isActive
                    ? 'bg-green-100 text-green-800'
                    : hasEnded
                    ? 'bg-gray-100 text-gray-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {isActive ? '🔴 Live' : hasEnded ? 'Ended' : 'Scheduled'}
              </span>
              {isConnected && isActive && (
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                  WebSocket Connected
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Meeting Info */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500">Host</h3>
              <p className="mt-1 text-sm text-gray-900">{meeting.host_email}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Meeting ID</h3>
              <p className="mt-1 text-sm text-gray-900 font-mono">{meeting.webex_meeting_id}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Attendees</h3>
              <p className="mt-1 text-sm text-gray-900">
                <UserGroupIcon className="h-4 w-4 inline mr-1" />
                Participants
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white shadow rounded-lg">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 px-6">
              <button
                onClick={() => setActiveTab('transcript')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'transcript'
                    ? 'border-webex-500 text-webex-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <DocumentTextIcon className="h-4 w-4 inline mr-2" />
                Live Transcript
              </button>
              {hasEnded && (
                <button
                  onClick={() => setActiveTab('summary')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'summary'
                      ? 'border-webex-500 text-webex-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <ChatBubbleLeftIcon className="h-4 w-4 inline mr-2" />
                  Summary & Chat
                </button>
              )}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'transcript' && (
              <LiveTranscript
                segments={transcriptSegments}
                isLive={isActive}
                isLoading={transcriptLoading}
                error={transcriptError}
              />
            )}
            {activeTab === 'summary' && hasEnded && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <MeetingSummary
                  summary={summary}
                  isLoading={summaryLoading}
                  error={summaryError}
                  meetingId={meetingId}
                />
                <ChatBot
                  meetingId={meetingId}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
