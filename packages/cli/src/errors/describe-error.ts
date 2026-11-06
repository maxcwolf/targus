import { isTargusError } from '@targus/core';

import { ExecError } from '../adapters/exec.adapter.ts';
import { exitCodeFor, failureExitCode } from './exit-codes.ts';
import { explainSystemError, type Explanation } from './system-error.ts';
import { summarizeIssues, zodIssues } from './zod-summary.ts';

/** How a failed command is reported: the text for stderr, the exit code, a Commander code. */
export interface ErrorReport {
  readonly message: string;
  readonly exitCode: number;
  readonly code: string;
}

export interface DescribeErrorOptions {
  /** Append the stack trace of the error and every cause (`TARGUS_DEBUG=1`). */
  readonly debug: boolean;
}

/** How deep the `cause` chain is followed; guards against a cycle. */
const maxCauseDepth = 10;

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (current !== undefined && current !== null && chain.length < maxCauseDepth) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function explainZod(value: unknown): Explanation | null {
  const issues = zodIssues(value);
  if (issues === null) return null;
  const count = issues.length === 1 ? '1 issue' : `${issues.length} issues`;
  return {
    summary: `data did not have the expected shape (${count}):\n${summarizeIssues(issues)}`,
    kind: 'invalid_data',
  };
}

/** The first error in the chain whose cause we can put in words. */
function explainChain(error: unknown): Explanation | null {
  for (const link of causeChain(error)) {
    const explanation = explainSystemError(link) ?? explainZod(link);
    if (explanation !== null) return explanation;
  }
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lines(headline: string, ...rest: (string | undefined)[]): string {
  const indented = rest.filter((line) => line !== undefined).map((line) => `  ${line}`);
  return [`error: ${headline}`, ...indented].join('\n');
}

function describe(error: unknown): ErrorReport {
  if (isTargusError(error)) {
    const cause = explainChain(error.cause);
    return {
      message: lines(error.message, cause?.summary, cause?.hint),
      exitCode: exitCodeFor(error.code),
      code: `targus.${error.code}`,
    };
  }
  const explanation = explainChain(error);
  if (explanation !== null) {
    const message = lines(explanation.summary, explanation.hint);
    return { message, exitCode: failureExitCode, code: `targus.${explanation.kind}` };
  }
  if (error instanceof ExecError) {
    return { message: lines(error.message), exitCode: failureExitCode, code: 'targus.exec' };
  }
  return {
    message: lines(
      `unexpected error: ${messageOf(error)}`,
      'this is probably a bug in targus; run again with TARGUS_DEBUG=1 for the stack trace',
    ),
    exitCode: failureExitCode,
    code: 'targus.unexpected',
  };
}

function stackTrace(error: unknown): string {
  return causeChain(error)
    .map((link, index) => {
      const text = link instanceof Error ? (link.stack ?? link.message) : String(link);
      return index === 0 ? text : `caused by: ${text}`;
    })
    .join('\n');
}

/**
 * Turn anything a command threw into a few plain lines for stderr and an exit code. No stack
 * trace unless `debug` is on.
 */
export function describeError(error: unknown, { debug }: DescribeErrorOptions): ErrorReport {
  const report = describe(error);
  if (!debug) return report;
  return { ...report, message: `${report.message}\n\n${stackTrace(error)}` };
}
