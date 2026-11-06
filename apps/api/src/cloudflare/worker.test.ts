import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { D1BuildRepository } from '../repositories/build.repository.ts';
import { R2ImageStore } from '../storage/r2-image-store.ts';
import { appFor } from './worker.ts';
import { createWorkerDeps } from './worker-deps.ts';

describe('createWorkerDeps', () => {
  it('builds the D1 repositories and the R2 image store from the bindings', () => {
    const deps = createWorkerDeps(env);

    expect(deps.builds).toBeInstanceOf(D1BuildRepository);
    expect(deps.imageStore).toBeInstanceOf(R2ImageStore);
    expect(deps.config.version).toBe(env.APP_VERSION);
  });

  it('refuses an invalid configuration before any request is served', () => {
    expect(() => createWorkerDeps({ ...env, PUBLIC_URL: 'not a url' })).toThrow();
  });
});

describe('the Worker entry', () => {
  it('builds the app once per env and reuses it for every request', () => {
    const app = appFor(env);

    expect(appFor(env)).toBe(app);
    expect(appFor({ ...env })).not.toBe(app);
  });

  it('hands the request to the app', async () => {
    const response = await exports.default.fetch('http://targus.test/api/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).not.toBeNull();
  });
});
