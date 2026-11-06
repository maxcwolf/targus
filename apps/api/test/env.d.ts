// Types for `env` and `exports` from "cloudflare:workers" inside tests.
import type { D1Migration } from 'cloudflare:test';

import type { Bindings } from '../src/cloudflare/bindings.ts';
import type worker from '../src/cloudflare/worker.ts';

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      readonly TEST_MIGRATIONS: D1Migration[];
    }

    interface GlobalProps {
      mainModule: { default: typeof worker };
    }
  }
}
