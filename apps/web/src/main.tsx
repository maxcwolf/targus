import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.js';
import { createAppRouter } from './app/router.js';

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing <div id="root">');

createRoot(container).render(
  <StrictMode>
    <App router={createAppRouter()} />
  </StrictMode>,
);
