#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createProgram } from './program.js';

await createProgram({ config: loadConfig() }).parseAsync(process.argv);
