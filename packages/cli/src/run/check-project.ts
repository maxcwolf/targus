import { isTargusError, type CurrentProjectResponse, type TargusError } from '@targus/core';

import { ApiRequestError } from '../adapters/api-errors.ts';
import type { TargusApi } from './targus-api.ts';

/** The same error with a new message, keeping the request id an API error carries. */
function reworded(error: TargusError, message: string): TargusError {
  const requestId = error instanceof ApiRequestError ? error.requestId : null;
  return new ApiRequestError(error.code, message, { cause: error, requestId });
}

/**
 * Ask the API which project the token belongs to, before the git work and the minutes-long
 * capture: a wrong or revoked token, or a URL that is not the targus API, fails in seconds.
 * Any other failure (the API unreachable) is thrown as the client reports it.
 */
export async function checkProject(
  api: TargusApi,
  apiUrl: string,
  log: (line: string) => void,
): Promise<void> {
  let project: CurrentProjectResponse['project'];
  try {
    ({ project } = await api.currentProject());
  } catch (error) {
    if (!isTargusError(error)) throw error;
    if (error.code === 'unauthorized') {
      throw reworded(
        error,
        `the targus API at ${apiUrl} rejected TARGUS_TOKEN: export the token printed when the ` +
          'project was created (a revoked token, or one whose project was deleted, is rejected)',
      );
    }
    if (error.code === 'not_found') {
      throw reworded(
        error,
        `${apiUrl} does not answer GET /api/projects/current: check that --api-url or ` +
          'TARGUS_API_URL is the targus API, and that it runs a version as new as this CLI',
      );
    }
    throw error;
  }
  log(`project: ${project.name} (${project.repo})`);
}
