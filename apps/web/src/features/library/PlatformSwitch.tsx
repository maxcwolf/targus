import { useNavigate } from '@tanstack/react-router';
import type { Platform } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { platformLabel } from '../../components/format.ts';
import { Tabs } from '../../components/Tabs.tsx';
import { librarySearch } from './stories.ts';

export interface PlatformSwitchProps {
  readonly projectId: string;
  /** Every platform with a library, in the order the API lists them. */
  readonly platforms: readonly Platform[];
  readonly current: Platform;
  /** The story open now, which stays open on the other platform; undefined for the overview. */
  readonly story: string | undefined;
}

/**
 * Switches the library between the platforms that have one (ADR 0036), through `?platform=`.
 * Nothing to switch with a single platform, so it renders nothing then.
 */
export function PlatformSwitch(props: PlatformSwitchProps): ReactElement | null {
  const { projectId, platforms, current, story } = props;
  const navigate = useNavigate();
  if (platforms.length < 2) return null;
  return (
    <Tabs
      label="Platform"
      segmented
      items={platforms.map((platform) => ({ id: platform, label: platformLabel(platform) }))}
      active={current}
      onSelect={(platform) => {
        const search = librarySearch(platform, story);
        void navigate({ to: '/projects/$projectId/library', params: { projectId }, search });
      }}
    />
  );
}
