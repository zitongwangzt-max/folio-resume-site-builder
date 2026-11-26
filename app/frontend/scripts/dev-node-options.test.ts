import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devNodeOptions } from './dev-node-options.mjs';

const FLAG = '--no-experimental-require-module';
const supported = new Set([FLAG]);

test('adds the flag when supported', () => {
  assert.equal(devNodeOptions('', supported), FLAG);
  assert.equal(devNodeOptions('--max-old-space-size=4096', supported), `--max-old-space-size=4096 ${FLAG}`);
});

test('does not duplicate the flag', () => {
  assert.equal(devNodeOptions(FLAG, supported), FLAG);
});

test('leaves NODE_OPTIONS alone on Node without the flag', () => {
  assert.equal(devNodeOptions('', new Set()), '');
  assert.equal(devNodeOptions('--inspect', new Set()), '--inspect');
});
