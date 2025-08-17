'use client';

import { useState } from 'react';
import { useDevAuth } from '@/components/dev-auth-provider';
import { Button } from '@/components/ui/button';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { 
  DocumentTextIcon, 
  SparklesIcon,
  ExclamationTriangleIcon 
} from '@heroicons/react/24/outline';

interface MeetingSummaryProps {
  summary: any;
  isLoading: boolean;
  error: any;
  meetingId: string;
}

export function MeetingSummary({ summary, isLoading, error, meetingId }: MeetingSummaryProps) {
  const { data: session } = useDevAuth();
  const { client } = useApi(session?.accessToken);
  const { execute, isLoading: isGenerating, error: generateError } = useApiMutation();
  const [selectedType, setSelectedType] = useState('concise');

  const handleGenerateSummary = async () => {
    const result = await execute(() => 
      client.generateSummary(meetingId, selectedType)
    );
    
    if (result) {
      // Refresh the page to show the new summary
      window.location.reload();
    }
  };

  if (error) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <DocumentTextIcon className="h-5 w-5 mr-2" />
          Meeting Summary
        </h3>
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-400" />
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">
                Failed to load summary
              </h3>
              <p className="text-sm text-red-700 mt-1">
                {error.message}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <DocumentTextIcon className="h-5 w-5 mr-2" />
          Meeting Summary
        </h3>
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 rounded w-5/6"></div>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <DocumentTextIcon className="h-5 w-5 mr-2" />
          Meeting Summary
        </h3>
        
        <div className="p-6 border-2 border-dashed border-gray-300 rounded-lg text-center">
          <SparklesIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">
            No summary available yet
          </h4>
          <p className="text-sm text-gray-500 mb-6">
            Generate an AI-powered summary of this meeting with key points, decisions, and action items.
          </p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Summary Type
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-webex-500 focus:ring-webex-500 sm:text-sm"
              >
                <option value="concise">Concise (Brief overview)</option>
                <option value="detailed">Detailed (Comprehensive summary)</option>
                <option value="action_items">Action Items (Focus on tasks)</option>
                <option value="decisions">Decisions (Key outcomes)</option>
              </select>
            </div>
            
            <Button
              onClick={handleGenerateSummary}
              isLoading={isGenerating}
              className="w-full"
            >
              <SparklesIcon className="h-4 w-4 mr-2" />
              Generate Summary
            </Button>
            
            {generateError && (
              <p className="text-sm text-red-600">{generateError.message}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <DocumentTextIcon className="h-5 w-5 mr-2" />
          Meeting Summary
        </h3>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          {summary.summary_type}
        </span>
      </div>

      <div className="bg-white border rounded-lg p-6 space-y-4">
        {/* Key Points */}
        {summary.key_points && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">Key Points</h4>
            <ul className="space-y-1 text-sm text-gray-700">
              {summary.key_points.map((point: string, index: number) => (
                <li key={index} className="flex items-start">
                  <span className="h-1.5 w-1.5 bg-webex-500 rounded-full mt-2 mr-2 flex-shrink-0"></span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Items */}
        {summary.action_items && summary.action_items.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">Action Items</h4>
            <ul className="space-y-2 text-sm text-gray-700">
              {summary.action_items.map((item: any, index: number) => (
                <li key={index} className="flex items-start p-2 bg-yellow-50 rounded">
                  <span className="h-4 w-4 text-yellow-600 mr-2 flex-shrink-0">📋</span>
                  <div>
                    <span className="font-medium">{item.task}</span>
                    {item.assignee && (
                      <span className="text-gray-500"> - {item.assignee}</span>
                    )}
                    {item.due_date && (
                      <span className="text-gray-500"> (Due: {item.due_date})</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Decisions */}
        {summary.decisions && summary.decisions.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">Decisions Made</h4>
            <ul className="space-y-2 text-sm text-gray-700">
              {summary.decisions.map((decision: string, index: number) => (
                <li key={index} className="flex items-start p-2 bg-green-50 rounded">
                  <span className="h-4 w-4 text-green-600 mr-2 flex-shrink-0">✅</span>
                  {decision}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Full Summary */}
        {summary.content && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">Summary</h4>
            <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {summary.content}
            </div>
          </div>
        )}

        <div className="text-xs text-gray-500 pt-2 border-t">
          Generated {new Date(summary.created_at).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
