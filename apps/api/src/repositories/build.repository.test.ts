import { env } from 'cloudflare:workers';

import {
  d1BuildHarness,
  inMemoryBuildHarness,
} from '../../test/support/contracts/build-harness.ts';
import { describeBuildContract } from '../../test/support/contracts/build.contract.ts';

describeBuildContract('D1BuildRepository (local D1)', () => d1BuildHarness(env.DB));
describeBuildContract('in-memory builds double', inMemoryBuildHarness);
