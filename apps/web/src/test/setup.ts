import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './msw.js';

// jsdom has no layout; the router restores scroll positions on navigation.
window.scrollTo = (): void => undefined;

// No network in tests: any request without an MSW handler fails the test. MSW 3 renamed
// `onUnhandledRequest` to `onUnhandledFrame` (it also covers WebSocket frames).
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
