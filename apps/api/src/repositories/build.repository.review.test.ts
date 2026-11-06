import { env } from 'cloudflare:workers';

import {
  d1BuildHarness,
  inMemoryBuildHarness,
} from '../../test/support/contracts/build-harness.ts';
import { describeBuildReviewContract } from '../../test/support/contracts/build-review.contract.ts';

describeBuildReviewContract('D1BuildRepository (local D1)', () => d1BuildHarness(env.DB));
describeBuildReviewContract('in-memory builds double', inMemoryBuildHarness);
