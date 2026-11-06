#!/usr/bin/env node
import { debugEnabled } from './config.js';
import { describeError } from './errors/describe-error.js';
import { createProgram } from './program.js';

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  // Commands report their own errors and exit; this catches anything that escapes them.
  const { message, exitCode } = describeError(error, { debug: debugEnabled() });
  process.stderr.write(`${message}\n`);
  process.exitCode = exitCode;
}
