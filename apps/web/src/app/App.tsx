import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { createQueryClient } from './query-client.ts';
import type { createAppRouter } from './router.tsx';

export interface AppProps {
  readonly router: ReturnType<typeof createAppRouter>;
  readonly queryClient?: QueryClient;
}

/** Providers plus the router. main.tsx mounts this; tests render it with a memory history. */
export function App({ router, queryClient = createQueryClient() }: AppProps): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
