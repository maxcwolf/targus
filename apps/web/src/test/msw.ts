import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/** Handlers every test starts from; tests override them with `server.use(...)`. */
export const healthyApi = http.get('*/api/health', () =>
  HttpResponse.json({ ok: true, version: '1.2.3' }),
);

export const server = setupServer(healthyApi);
