// Types for `env` and `exports` from "cloudflare:workers" inside tests.
import type { D1Migration } from 'cloudflare:test';

import type { Bindings } from '../src/bindings.js';
import type app from '../src/index.js';

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      readonly TEST_MIGRATIONS: D1Migration[];
    }

    interface GlobalProps {
      mainModule: { default: typeof app };
    }
  }
}
