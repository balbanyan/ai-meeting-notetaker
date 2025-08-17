'use client';

import { SWRConfig } from 'swr';
import { DevAuthProvider } from './dev-auth-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DevAuthProvider>
      <SWRConfig
        value={{
          fetcher: (resource, init) =>
            fetch(resource, init).then((res) => res.json()),
          revalidateOnFocus: false,
          revalidateOnReconnect: true,
        }}
      >
        {children}
      </SWRConfig>
    </DevAuthProvider>
  );
}
