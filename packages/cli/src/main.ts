#!/usr/bin/env node
import { TwoGraphError } from '@twograph/core';
import { buildProgram } from './program.js';

try {
  await buildProgram().parseAsync(process.argv);
} catch (err) {
  if (err instanceof TwoGraphError) {
    console.error(`error [${err.code}]: ${err.message}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
