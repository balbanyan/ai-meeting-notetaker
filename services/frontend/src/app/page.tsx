'use client';

import { useDevAuth } from '@/components/dev-auth-provider';
import { useApi } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { AddBotDialog } from '@/components/meeting/add-bot-dialog';
import { MeetingCard } from '@/components/meeting/meeting-card';
import { useState } from 'react';
import { CalendarIcon, PlusIcon } from '@heroicons/react/24/outline';

export default function Dashboard() {
  const { data: session, status, signIn, signOut } = useDevAuth();
  const [showAddBot, setShowAddBot] = useState(false);
  const { useMeetings, useHealth } = useApi(session?.accessToken);
  const { data: meetings, error: meetingsError, isLoading: meetingsLoading } = useMeetings();
  const { data: health } = useHealth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-webex-600"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <CalendarIcon className="h-12 w-12 text-webex-600" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            AI Meeting Notetaker
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Development Mode - Using your Webex access token
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            <Button
              onClick={signIn}
              className="w-full"
              size="lg"
            >
              Sign in (Development Mode)
            </Button>
            
            {health ? (
              <div className="mt-4 text-center">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  API Connected
                </span>
              </div>
            ) : null}
            
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-xs text-yellow-700">
                <strong>Development Mode:</strong> Make sure you've set your Webex access token in .env.local as NEXT_PUBLIC_WEBEX_ACCESS_TOKEN
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <CalendarIcon className="h-8 w-8 text-webex-600 mr-3" />
              <h1 className="text-2xl font-bold text-gray-900">
                AI Meeting Notetaker
              </h1>
              <span className="ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                Dev Mode
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">
                Welcome, {session.user?.name}
              </span>
              <Button
                variant="secondary"
                onClick={signOut}
              >
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Your Meetings</h2>
            <p className="text-sm text-gray-500">
              View and manage your AI-assisted meeting notes
            </p>
          </div>
          <Button
            onClick={() => setShowAddBot(true)}
            className="flex items-center"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Add AI Bot to Meeting
          </Button>
        </div>

        {/* API Status */}
        {health ? (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-md">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-green-800">
                  Backend API is connected and healthy
                </p>
                <p className="text-sm text-green-700">
                  Database: {(health as any)?.database} | Vector DB: {(health as any)?.pgvector}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Meetings List */}
        <div className="bg-white shadow rounded-lg">
          {meetingsLoading ? (
            <div className="p-6 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-webex-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading meetings...</p>
            </div>
          ) : meetingsError ? (
            <div className="p-6 text-center">
              <p className="text-sm text-red-600">Failed to load meetings</p>
              <p className="text-xs text-gray-500 mt-1">{meetingsError.message}</p>
            </div>
          ) : !meetings || meetings.length === 0 ? (
            <div className="p-6 text-center">
              <CalendarIcon className="h-12 w-12 text-gray-300 mx-auto" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No meetings yet</h3>
              <p className="mt-1 text-sm text-gray-500">
                Add the AI bot to a Webex meeting to get started.
              </p>
              <div className="mt-6">
                <Button onClick={() => setShowAddBot(true)}>
                  <PlusIcon className="h-4 w-4 mr-2" />
                  Add AI Bot to Meeting
                </Button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {meetings.map((meeting: any) => (
                <MeetingCard
                  key={meeting.id}
                  meeting={meeting}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Add Bot Dialog */}
      <AddBotDialog
        isOpen={showAddBot}
        onClose={() => setShowAddBot(false)}
        onSuccess={() => {
          setShowAddBot(false);
          // Refresh meetings list
          window.location.reload();
        }}
      />
    </div>
  );
}
