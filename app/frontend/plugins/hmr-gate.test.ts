import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hmrGatePlugin } from './vendor/hmr-gate-1.8.2.mjs';

type Req = { method: string; url: string; headers: Record<string, string> };
type Res = { statusCode: number; body?: string; writeHead(status: number): void; end(body?: string): void };

function fakeServer(options: Record<string, unknown> = {}, cacheDir = '/tmp/vite-cache', publicDir = '/work/public') {
  const plugin = hmrGatePlugin({ fullReload: true, ...options });
  const middlewares: Array<(req: Req, res: Res, next: () => void) => void> = [];
  const emitted: string[] = [];
  const sent: unknown[] = [];
  let invalidations = 0;
  const srv = {
    middlewares: { use: (fn: (req: Req, res: Res, next: () => void) => void) => middlewares.push(fn) },
    watcher: { emit: (event: string, file: string) => { emitted.push(`${event}:${file}`); return true; } },
    moduleGraph: { invalidateAll: () => { invalidations += 1; }, onFileChange: () => {} },
    ws: { send: (payload: unknown) => sent.push(payload), on: () => {} },
  };
  plugin.configResolved({ cacheDir, publicDir });
  plugin.configureServer(srv);
  const request = (method: string, url: string, headers: Record<string, string> = {}) => {
    const res: Res = {
      statusCode: 200,
      writeHead(status) { this.statusCode = status; },
      end(body) { this.body = body; },
    };
    let i = 0;
    const next = () => { const fn = middlewares[i++]; if (fn) fn({ method, url, headers }, res, next); };
    next();
    return res;
  };
  return {
    srv, emitted, sent, request,
    get invalidations() { return invalidations; },
    change: (file: string) => srv.watcher.emit('change', file),
    pending: () => JSON.parse(request('GET', '/__hmr_gate').body ?? '{}').count as number,
  };
}

function tempFile(content: string) {
  const file = join(mkdtempSync(join(tmpdir(), 'hmr-gate-')), 'App.tsx');
  writeFileSync(file, content);
  return file;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('changes are held until flush', () => {
  const gate = fakeServer();
  const file = tempFile('a');
  gate.change(file);
  assert.deepEqual(gate.emitted, []);
  assert.equal(gate.pending(), 1);
  gate.request('POST', '/__hmr_flush');
  assert.deepEqual(gate.emitted, [`change:${file}`]);
  assert.equal(gate.pending(), 0);
});

test('failOpen false keeps updates held past maxHoldMs', async () => {
  const gate = fakeServer({ failOpen: false, maxHoldMs: 10 });
  gate.change(tempFile('a'));
  await sleep(40);
  assert.deepEqual(gate.emitted, []);
  assert.equal(gate.pending(), 1);
});

test('default fail-open releases held updates after maxHoldMs', async () => {
  const gate = fakeServer({ maxHoldMs: 10 });
  const file = tempFile('a');
  gate.change(file);
  await sleep(40);
  assert.deepEqual(gate.emitted, [`change:${file}`]);
});

test('navigation with pending updates invalidates without flushing', () => {
  const gate = fakeServer();
  gate.request('GET', '/', { accept: 'text/html' });
  assert.equal(gate.invalidations, 0);
  gate.change(tempFile('a'));
  gate.request('GET', '/', { accept: 'text/html' });
  assert.equal(gate.invalidations, 1);
  assert.deepEqual(gate.emitted, []);
});

test('revert after navigation is held, not dropped as unchanged', () => {
  const gate = fakeServer();
  const file = tempFile('A');
  gate.change(file);
  gate.request('POST', '/__hmr_flush');
  writeFileSync(file, 'B');
  gate.change(file);
  gate.request('GET', '/', { accept: 'text/html' });
  writeFileSync(file, 'A');
  gate.change(file);
  assert.equal(gate.pending(), 1);
  gate.request('POST', '/__hmr_flush');
  assert.deepEqual(gate.emitted, [`change:${file}`, `change:${file}`]);
});

test('files under cacheDir pass through', () => {
  const gate = fakeServer({}, '/work/.mgx-gate-cache');
  gate.change('/work/.mgx-gate-cache/deps/react.js');
  assert.deepEqual(gate.emitted, ['change:/work/.mgx-gate-cache/deps/react.js']);
  gate.change('/work/.mgx-gate-cache-src/App.tsx');
  assert.equal(gate.emitted.length, 1);
});

test('token, when set, is required on gate endpoints', () => {
  const gate = fakeServer({ token: 's3cret' });
  gate.change(tempFile('a'));
  assert.equal(gate.request('GET', '/__hmr_gate').statusCode, 401);
  assert.equal(gate.request('POST', '/__hmr_flush', { 'x-mgx-hmr-token': 'wrong!' }).statusCode, 401);
  assert.deepEqual(gate.emitted, []);
  assert.equal(gate.request('POST', '/__hmr_flush', { 'x-mgx-hmr-token': 's3cret' }).statusCode, 200);
  assert.equal(gate.emitted.length, 1);
});

test('new public files pass through so a new document can load them', () => {
  const gate = fakeServer();
  gate.srv.watcher.emit('add', '/work/public/hero.png');
  assert.deepEqual(gate.emitted, ['add:/work/public/hero.png']);
  gate.change('/work/public-src/App.tsx');
  assert.equal(gate.emitted.length, 1);
});
