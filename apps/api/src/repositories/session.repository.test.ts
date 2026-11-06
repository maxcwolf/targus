import { env } from 'cloudflare:workers';

import { describeSessionContract } from '../../test/support/contracts/session.contract.ts';
import { createInMemorySessions, createInMemoryUsers } from '../../test/support/in-memory-auth.ts';
import { createSessionRepository } from './session.repository.ts';
import { createUserRepository } from './user.repository.ts';

describeSessionContract('createSessionRepository (local D1)', () => ({
  repository: createSessionRepository(env.DB),
  users: createUserRepository(env.DB),
}));

describeSessionContract('in-memory sessions double', () => {
  const users = createInMemoryUsers();
  return { repository: createInMemorySessions(users), users };
});
