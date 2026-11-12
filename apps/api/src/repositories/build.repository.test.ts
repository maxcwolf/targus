import { env } from 'cloudflare:workers';

import {
  d1BuildHarness,
  inMemoryBuildHarness,
} from '../../test/support/contracts/build-harness.ts';
import { describeBuildHistory } from '../../test/support/contracts/build-history.contract.ts';
import { describeBuildContract } from '../../test/support/contracts/build.contract.ts';

describeBuildContract('D1BuildRepository (local D1)', () => d1BuildHarness(env.DB));
describeBuildContract('in-memory builds double', inMemoryBuildHarness);
describeBuildHistory('D1BuildRepository (local D1)', () => d1BuildHarness(env.DB));
describeBuildHistory('in-memory builds double', inMemoryBuildHarness);
