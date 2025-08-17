'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { 
  CalendarIcon, 
  ClockIcon, 
  UserGroupIcon,
  DocumentTextIcon,
  ChatBubbleLeftIcon
} from '@heroicons/react/24/outline';

interface MeetingCardProps {
  meeting: {
    id: string;
    title: string;
    webex_meeting_id: string;
    host_email: string;
    start_time: string;
    end_time?: string;
    status: string;

  };
}

export function MeetingCard({ meeting }: MeetingCardProps) {
  const startTime = new Date(meeting.start_time);
  const endTime = meeting.end_time ? new Date(meeting.end_time) : null;
  const isActive = meeting.status === 'active';
  const hasEnded = meeting.status === 'ended';

  const getDuration = () => {
    if (!endTime) return null;
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));
    if (duration < 60) return `${duration}m`;
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  };

  return (
    <div className="p-6 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <h3 className="text-lg font-medium text-gray-900">
              <Link 
                href={`/meeting/${meeting.id}`}
                className="hover:text-webex-600 transition-colors"
              >
                {meeting.title}
              </Link>
            </h3>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                isActive
                  ? 'bg-green-100 text-green-800'
                  : hasEnded
                  ? 'bg-gray-100 text-gray-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}
            >
              {isActive ? 'Live' : hasEnded ? 'Ended' : 'Scheduled'}
            </span>
          </div>

          <div className="flex flex-wrap items-center text-sm text-gray-500 space-x-4 mb-3">
            <div className="flex items-center">
              <CalendarIcon className="h-4 w-4 mr-1" />
              {formatDistanceToNow(startTime, { addSuffix: true })}
            </div>
            
            {getDuration() && (
              <div className="flex items-center">
                <ClockIcon className="h-4 w-4 mr-1" />
                {getDuration()}
              </div>
            )}

          </div>

          <p className="text-sm text-gray-600 mb-3">
            Host: {meeting.host_email}
          </p>

          <div className="flex space-x-4">
            <Link
              href={`/meeting/${meeting.id}`}
              className="inline-flex items-center text-sm text-webex-600 hover:text-webex-500"
            >
              <DocumentTextIcon className="h-4 w-4 mr-1" />
              View Transcript
            </Link>
            
            {hasEnded && (
              <Link
                href={`/meeting/${meeting.id}#summary`}
                className="inline-flex items-center text-sm text-webex-600 hover:text-webex-500"
              >
                <ChatBubbleLeftIcon className="h-4 w-4 mr-1" />
                Summary & Chat
              </Link>
            )}
          </div>
        </div>

        <div className="ml-4">
          <Link
            href={`/meeting/${meeting.id}`}
            className="text-webex-600 hover:text-webex-500 text-sm font-medium"
          >
            View Details →
          </Link>
        </div>
      </div>
    </div>
  );
}
