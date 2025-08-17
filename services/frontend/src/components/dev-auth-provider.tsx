'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  id: string;
  name: string;
  email: string;
}

interface DevAuthSession {
  user?: User;
  accessToken?: string;
}

interface DevAuthContextType {
  data: DevAuthSession | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  signIn: () => Promise<void>;
  signOut: () => void;
}

const DevAuthContext = createContext<DevAuthContextType | undefined>(undefined);

export function DevAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DevAuthSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  // Check for stored session on mount
  useEffect(() => {
    const stored = localStorage.getItem('dev-auth-session');
    if (stored) {
      const parsedSession = JSON.parse(stored);
      setSession(parsedSession);
      setStatus('authenticated');
    } else {
      setStatus('unauthenticated');
    }
  }, []);

  const signIn = async () => {
    const accessToken = process.env.NEXT_PUBLIC_WEBEX_ACCESS_TOKEN;
    
    if (!accessToken) {
      throw new Error('No Webex access token configured. Please set NEXT_PUBLIC_WEBEX_ACCESS_TOKEN in .env.local');
    }

    // Create a mock user session using the access token
    const mockSession: DevAuthSession = {
      user: {
        id: 'dev-user',
        name: 'Development User',
        email: 'dev@example.com'
      },
      accessToken
    };

    localStorage.setItem('dev-auth-session', JSON.stringify(mockSession));
    setSession(mockSession);
    setStatus('authenticated');
  };

  const signOut = () => {
    localStorage.removeItem('dev-auth-session');
    setSession(null);
    setStatus('unauthenticated');
  };

  return (
    <DevAuthContext.Provider value={{
      data: session,
      status,
      signIn,
      signOut
    }}>
      {children}
    </DevAuthContext.Provider>
  );
}

export function useDevAuth() {
  const context = useContext(DevAuthContext);
  if (context === undefined) {
    throw new Error('useDevAuth must be used within a DevAuthProvider');
  }
  return context;
}
