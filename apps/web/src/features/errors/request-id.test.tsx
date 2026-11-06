import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiError, server } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';

describe('error pages show the request id', () => {
  it('shows the id from the error body, labelled, below the message', async () => {
    server.use(
      http.get('*/api/projects', () =>
        apiError(500, 'internal', 'Internal Server Error', 'req-from-the-body'),
      ),
    );
    renderApp('/');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    expect(alert).toHaveTextContent('Internal Server Error');
    expect(within(alert).getByText('Request id:', { exact: false })).toHaveTextContent(
      'Request id: req-from-the-body',
    );
    expect(within(alert).getByText('req-from-the-body').tagName).toBe('CODE');
  });

  it('falls back to the x-request-id header when the body has no id', async () => {
    server.use(
      http.get(
        '*/api/projects',
        () =>
          new HttpResponse('<html>Bad Gateway</html>', {
            status: 502,
            headers: { 'content-type': 'text/html', 'x-request-id': 'req-from-the-header' },
          }),
      ),
    );
    renderApp('/');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('targus API answered 502 for /api/projects');
    expect(alert).toHaveTextContent('Request id: req-from-the-header');
  });

  it('shows the id on the no-access and not-found pages too', async () => {
    server.use(
      http.get('*/api/builds/:buildId', () =>
        apiError(404, 'not_found', 'Build not found', 'req-of-a-404'),
      ),
    );
    renderApp('/builds/build-12');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Not found' })).toBeVisible();
    expect(alert).toHaveTextContent('Request id: req-of-a-404');
  });
});

describe('error pages without a request id', () => {
  it('shows no id when the answer carried none', async () => {
    server.use(http.get('*/api/projects', () => apiError(403, 'forbidden', 'Forbidden')));
    renderApp('/');

    expect(await screen.findByRole('alert')).not.toHaveTextContent('Request id');
  });

  it('shows no id when the request never reached the API', async () => {
    server.use(http.get('*/api/projects', () => HttpResponse.error()));
    renderApp('/');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    expect(alert).not.toHaveTextContent('Request id');
  });
});
