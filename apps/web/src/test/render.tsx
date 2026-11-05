import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, type RenderResult } from '@testing-library/react';

import { App } from '../app/App.js';
import { createAppRouter } from '../app/router.js';

/** A QueryClient that fails fast so error states are reachable in tests. */
function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

export interface RenderedApp extends RenderResult {
  readonly router: ReturnType<typeof createAppRouter>;
}

/** The whole app (providers, auth gate, router) at `path`, against the MSW API. */
export function renderApp(path: string): RenderedApp {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const result = render(<App router={router} queryClient={createTestQueryClient()} />);
  return { ...result, router };
}
