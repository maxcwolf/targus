import { z } from 'zod';

const Issue = z.object({ path: z.array(z.unknown()), message: z.string() });

/** Anything shaped like a `ZodError`, whichever copy of zod threw it. */
const ZodErrorShape = z.object({ name: z.literal('ZodError'), issues: z.array(Issue) });

export type ZodIssues = z.infer<typeof ZodErrorShape>['issues'];

/** The issues of a `ZodError`, or `null` when `error` is not one. */
export function zodIssues(error: unknown): ZodIssues | null {
  const parsed = ZodErrorShape.safeParse(error);
  return parsed.success ? parsed.data.issues : null;
}

/** One `- path: message` line per issue, at most `max` of them, indented for a CLI message. */
export function summarizeIssues(issues: ZodIssues, max = 5): string {
  const lines = issues.slice(0, max).map(({ path, message }) => {
    const where = path.length === 0 ? '(root)' : path.map(String).join('.');
    return `  - ${where}: ${message}`;
  });
  if (issues.length > max) lines.push(`  - and ${issues.length - max} more`);
  return lines.join('\n');
}
