import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTestQueryClient } from '../test/render.js';
import { App } from './App.js';
import { createAppRouter } from './router.js';

describe('App', () => {
  it('renders the home page with the API health badge at /', async () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/'] }));
    render(<App router={router} queryClient={createTestQueryClient()} />);

    expect(await screen.findByText(/Visual review for React Native/)).toBeInTheDocument();
    expect(await screen.findByText('API: ok (v1.2.3)')).toBeInTheDocument();
  });
});
