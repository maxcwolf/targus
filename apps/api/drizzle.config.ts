import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations from src/db/schema.ts into migrations/, which wrangler applies
// (`wrangler d1 migrations apply`) and the tests apply to the local D1 binding.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
