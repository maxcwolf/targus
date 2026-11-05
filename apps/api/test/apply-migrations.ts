import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Bring the local D1 binding up to the committed migrations before each test file.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
