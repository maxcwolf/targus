import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import type { createAppRouter } from './router.js';

export interface AppProps {
  readonly router: ReturnType<typeof createAppRouter>;
  readonly queryClient?: QueryClient;
}

/** Providers plus the router. main.tsx mounts this; tests render it with a memory history. */
export function App({ router, queryClient = new QueryClient() }: AppProps): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
