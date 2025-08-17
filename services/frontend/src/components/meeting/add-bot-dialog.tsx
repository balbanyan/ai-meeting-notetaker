'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { useDevAuth } from '@/components/dev-auth-provider';
import { XMarkIcon } from '@heroicons/react/24/outline';

const addBotSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID is required'),
  meetingTitle: z.string().min(1, 'Meeting title is required'),
  hostEmail: z.string().email('Valid email is required'),
});

type AddBotForm = z.infer<typeof addBotSchema>;

interface AddBotDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddBotDialog({ isOpen, onClose, onSuccess }: AddBotDialogProps) {
  const { data: session } = useDevAuth();
  const { client } = useApi(session?.accessToken);
  const { execute, isLoading, error } = useApiMutation();
  
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<AddBotForm>({
    resolver: zodResolver(addBotSchema),
    defaultValues: {
      hostEmail: session?.user?.email || '',
    },
  });

  const onSubmit = async (data: AddBotForm) => {
    const result = await execute(() =>
      client.joinMeeting({
        webex_meeting_id: data.meetingId,
        title: data.meetingTitle,
        host_email: data.hostEmail,
      })
    );

    if (result) {
      reset();
      onSuccess();
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <div className="absolute right-0 top-0 hidden pr-4 pt-4 sm:block">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-webex-500 focus:ring-offset-2"
                    onClick={handleClose}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>

                <div>
                  <Dialog.Title
                    as="h3"
                    className="text-base font-semibold leading-6 text-gray-900"
                  >
                    Add AI Bot to Webex Meeting
                  </Dialog.Title>
              
              <div className="mt-2">
                <p className="text-sm text-gray-500">
                  Add the AI notetaker bot to your Webex meeting. The bot will join automatically and start transcribing.
                </p>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
                <Input
                  label="Meeting ID or Link"
                  placeholder="123-456-789 or full Webex meeting URL"
                  error={errors.meetingId?.message}
                  {...register('meetingId')}
                />

                <Input
                  label="Meeting Title"
                  placeholder="Weekly Team Standup"
                  error={errors.meetingTitle?.message}
                  {...register('meetingTitle')}
                />

                <Input
                  label="Host Email"
                  type="email"
                  placeholder="host@company.com"
                  error={errors.hostEmail?.message}
                  {...register('hostEmail')}
                />

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm text-red-600">{error.message}</p>
                  </div>
                )}

                <div className="mt-6 flex space-x-3">
                  <Button
                    type="submit"
                    isLoading={isLoading}
                    className="flex-1"
                  >
                    Add AI Bot
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleClose}
                    disabled={isLoading}
                  >
                    Cancel
                  </Button>
                </div>
              </form>

              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-xs text-blue-700">
                  <strong>Note:</strong> The AI bot will join the meeting as "AI Space Notetaker" and will only record audio for transcription purposes. Meeting summaries will be available after the meeting ends.
                </p>
                </div>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </div>
    </Dialog>
  </Transition>
  );
}
