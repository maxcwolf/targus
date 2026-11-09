import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations from src/postgres/schema.ts into migrations-postgres/, which a host
// on Postgres applies with drizzle's migrator before it serves (ADR 0044). The D1 migrations in
// migrations/ come from drizzle.config.ts and are not touched by this.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/postgres/schema.ts',
  out: './migrations-postgres',
});
