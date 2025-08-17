'use client';

import { getProviders, signIn, getSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from '@heroicons/react/24/outline';

export default function SignIn() {
  const [providers, setProviders] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    // Check if already signed in
    getSession().then((session) => {
      if (session) {
        router.push('/');
      }
    });

    // Get available providers
    getProviders().then((res) => {
      setProviders(res);
    });
  }, [router]);

  if (!providers) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-webex-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <CalendarIcon className="h-12 w-12 text-webex-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Sign in to your account
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Access your AI-powered meeting notes
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="space-y-4">
            {Object.values(providers).map((provider: any) => (
              <div key={provider.name}>
                <Button
                  onClick={() => signIn(provider.id)}
                  className="w-full"
                  size="lg"
                >
                  Sign in with {provider.name}
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Secure OAuth authentication</span>
              </div>
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="text-xs text-gray-500">
              By signing in, you agree to access your Webex meetings for AI-powered note-taking.
              Your privacy and data security are our top priorities.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
