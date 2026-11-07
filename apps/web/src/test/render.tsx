import { createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, type RenderResult } from '@testing-library/react';

import { App } from '../app/App.tsx';
import { createQueryClient } from '../app/query-client.ts';
import { createAppRouter } from '../app/router.tsx';

export interface RenderedApp extends RenderResult {
  readonly router: ReturnType<typeof createAppRouter>;
}

/** The whole app (providers, auth gate, router) at `path`, against the MSW API. */
export function renderApp(path: string): RenderedApp {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const result = render(<App router={router} queryClient={createQueryClient({ retry: false })} />);
  return { ...result, router };
}

/** jsdom never loads images, so fire `load` on every image on screen, as a browser would. */
export function loadImages(): void {
  for (const image of document.querySelectorAll('img')) fireEvent.load(image);
}
