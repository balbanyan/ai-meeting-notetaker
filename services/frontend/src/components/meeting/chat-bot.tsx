'use client';

import { useState, useRef, useEffect } from 'react';
import { useDevAuth } from '@/components/dev-auth-provider';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { 
  ChatBubbleLeftIcon,
  PaperAirplaneIcon,
  UserIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  sources?: any[];
  timestamp: Date;
}

interface ChatBotProps {
  meetingId: string;
}

export function ChatBot({ meetingId }: ChatBotProps) {
  const { data: session } = useDevAuth();
  const { client } = useApi(session?.accessToken);
  const { execute, isLoading, error } = useApiMutation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const { register, handleSubmit, reset, formState: { errors } } = useForm<{ question: string }>();

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Add welcome message
  useEffect(() => {
    setMessages([{
      id: 'welcome',
      type: 'assistant',
      content: 'Hi! I can help you find information from this meeting. Ask me anything about what was discussed, decisions made, or action items.',
      timestamp: new Date()
    }]);
  }, []);

  const onSubmit = async (data: { question: string }) => {
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: data.question,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    reset();

    const response = await execute(() => 
      client.chatWithMeeting(meetingId, data.question)
    );

    if (response) {
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: response.answer,
        sources: response.sources,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, assistantMessage]);
    } else if (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: 'Sorry, I encountered an error processing your question. Please try again.',
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  const suggestedQuestions = [
    "What were the main topics discussed?",
    "What decisions were made?",
    "Are there any action items?",
    "Who said what about the budget?",
    "What are the next steps?"
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-gray-900 flex items-center">
        <ChatBubbleLeftIcon className="h-5 w-5 mr-2" />
        Ask Questions
      </h3>

      <div className="bg-white border rounded-lg flex flex-col h-96">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                  message.type === 'user'
                    ? 'bg-webex-600 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <div className="flex items-start space-x-2">
                  {message.type === 'assistant' && (
                    <SparklesIcon className="h-4 w-4 mt-1 flex-shrink-0" />
                  )}
                  {message.type === 'user' && (
                    <UserIcon className="h-4 w-4 mt-1 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    
                    {/* Sources */}
                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <p className="text-xs font-medium text-gray-600 mb-1">Sources:</p>
                        <ul className="text-xs text-gray-500 space-y-1">
                          {message.sources.map((source, index) => (
                            <li key={index} className="truncate">• {source}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    <p className="text-xs mt-1 opacity-75">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-900 max-w-xs lg:max-w-md px-4 py-2 rounded-lg">
                <div className="flex items-center space-x-2">
                  <SparklesIcon className="h-4 w-4" />
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Questions */}
        {messages.length === 1 && (
          <div className="px-4 py-2 border-t bg-gray-50">
            <p className="text-xs font-medium text-gray-600 mb-2">Suggested questions:</p>
            <div className="flex flex-wrap gap-1">
              {suggestedQuestions.map((question, index) => (
                <button
                  key={index}
                  onClick={() => onSubmit({ question })}
                  className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-50 transition-colors"
                  disabled={isLoading}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t">
          <form onSubmit={handleSubmit(onSubmit)} className="flex space-x-2">
            <div className="flex-1">
              <Input
                placeholder="Ask a question about this meeting..."
                {...register('question', { required: 'Please enter a question' })}
                error={errors.question?.message}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={isLoading}
              isLoading={isLoading}
            >
              <PaperAirplaneIcon className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
