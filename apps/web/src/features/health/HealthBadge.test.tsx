import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../../test/msw.js';
import { renderWithQuery } from '../../test/render.js';
import { HealthBadge } from './HealthBadge.js';

describe('HealthBadge', () => {
  it('shows ok and the API version when the API is healthy', async () => {
    renderWithQuery(<HealthBadge />);

    expect(screen.getByRole('status')).toHaveTextContent('API: checking…');
    expect(await screen.findByText('API: ok (v1.2.3)')).toHaveAttribute('data-state', 'ok');
  });

  it('shows down when the API answers with an error', async () => {
    server.use(http.get('*/api/health', () => new HttpResponse(null, { status: 503 })));
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText('API: down')).toHaveAttribute('data-state', 'down');
  });

  it('shows down when the API reports not ok', async () => {
    server.use(http.get('*/api/health', () => HttpResponse.json({ ok: false, version: '1.2.3' })));
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText('API: down')).toBeInTheDocument();
  });

  it('treats a response that breaks the contract as down', async () => {
    server.use(http.get('*/api/health', () => HttpResponse.json({ ok: 'yes' })));
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText('API: down')).toBeInTheDocument();
  });
});
