import { InstallationId } from '@targus/core/browser';

/** `/new?installation=7`: the App installation whose repositories are listed. */
export interface NewProjectSearch {
  readonly installation?: number;
}

function installationOf(value: unknown): NewProjectSearch {
  const parsed = InstallationId.safeParse(value);
  return parsed.success ? { installation: parsed.data } : {};
}

/** TanStack Router `validateSearch` for `/new`: anything but a positive integer is dropped. */
export function validateNewProjectSearch(search: Record<string, unknown>): NewProjectSearch {
  return installationOf(search.installation);
}

/**
 * `validateSearch` for `/setup`, where GitHub sends someone after installing the App with
 * `?installation_id=7&setup_action=install`. The result is `/new`'s search.
 */
export function validateSetupSearch(search: Record<string, unknown>): NewProjectSearch {
  return installationOf(search.installation_id);
}
