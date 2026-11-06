import { createMemoryHistory } from '@tanstack/react-router';
import { render, type RenderResult } from '@testing-library/react';

import { App } from '../app/App.js';
import { createQueryClient } from '../app/query-client.js';
import { createAppRouter } from '../app/router.js';

export interface RenderedApp extends RenderResult {
  readonly router: ReturnType<typeof createAppRouter>;
}

/** The whole app (providers, auth gate, router) at `path`, against the MSW API. */
export function renderApp(path: string): RenderedApp {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const result = render(<App router={router} queryClient={createQueryClient({ retry: false })} />);
  return { ...result, router };
}
