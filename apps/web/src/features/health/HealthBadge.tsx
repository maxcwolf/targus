import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { getHealth } from '../../api-client/index.js';

/** Shows whether the targus API is reachable and which version answered. */
export function HealthBadge(): ReactElement {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth });

  if (health.isPending) {
    return <span role="status">API: checking…</span>;
  }
  if (health.isError || !health.data.ok) {
    return (
      <span role="status" data-state="down">
        API: down
      </span>
    );
  }
  return (
    <span role="status" data-state="ok">
      API: ok (v{health.data.version})
    </span>
  );
}
