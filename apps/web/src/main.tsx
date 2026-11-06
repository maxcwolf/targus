import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

import { App } from './app/App.tsx';
import { createAppRouter } from './app/router.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing <div id="root">');

createRoot(container).render(
  <StrictMode>
    <App router={createAppRouter()} />
  </StrictMode>,
);
