#!/usr/bin/env node
import { debugEnabled } from './config.ts';
import { describeError } from './errors/describe-error.ts';
import { createProgram } from './program.ts';

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  // Commands report their own errors and exit; this catches anything that escapes them.
  const { message, exitCode } = describeError(error, { debug: debugEnabled() });
  process.stderr.write(`${message}\n`);
  process.exitCode = exitCode;
}
