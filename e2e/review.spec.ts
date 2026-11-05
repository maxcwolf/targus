import { expect, test } from '@playwright/test';

// M1: the e2e harness running an empty flow. The review flow from
// docs/engineering-standards.md section 3.3 (seeded build, stubbed GitHub OAuth, approve and
// deny, check-run assertions) replaces this as M2 and M3 land.
test('the review UI is served by the Worker and reaches the API', async ({ page }) => {
  await page.goto('/');

  const badge = page.getByRole('status');
  await expect(badge).toHaveText(/^API: ok \(v.+\)$/);
  await expect(badge).toHaveAttribute('data-state', 'ok');
});
