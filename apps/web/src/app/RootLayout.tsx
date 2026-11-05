import { Link, Outlet } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { AuthGate } from '../features/auth/AuthGate.js';
import { UserMenu } from '../features/auth/UserMenu.js';
import { useMe } from '../features/auth/useMe.js';

function TopBar(): ReactElement {
  const me = useMe();
  return (
    <header className="top-bar">
      <Link to="/" className="brand">
        targus
      </Link>
      {me.data ? <UserMenu user={me.data.user} /> : null}
    </header>
  );
}

/** Header plus the auth gate around every page. */
export function RootLayout(): ReactElement {
  return (
    <>
      <TopBar />
      <main className="page">
        <AuthGate>
          <Outlet />
        </AuthGate>
      </main>
    </>
  );
}
