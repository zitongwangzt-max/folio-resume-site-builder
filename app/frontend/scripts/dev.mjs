// Starts vite with the NODE_OPTIONS from dev-node-options.mjs.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { devNodeOptions } from './dev-node-options.mjs';

const require = createRequire(import.meta.url);
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: devNodeOptions(process.env.NODE_OPTIONS) },
});

const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const forward = signal => child.kill(signal);
for (const signal of signals) process.on(signal, forward);

child.on('exit', (code, signal) => {
  if (signal) {
    for (const s of signals) process.off(s, forward);
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
