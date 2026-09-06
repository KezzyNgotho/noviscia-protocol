import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractToken, isValidScope, TOKEN_SCOPES } from './tokens';

test('extractToken honors X-Noviscia-App-Token as the canonical header', () => {
  const headers = {
    'x-noviscia-app-token': 'nvk_<redacted>-institutional',
    'x-api-key': 'nvk_<redacted>-legacy',
  };
  assert.equal(extractToken(headers), 'nvk_<redacted>-institutional');
});

test('extractToken falls back to the x-api-key alias', () => {
  assert.equal(extractToken({ 'x-api-key': 'nvk_legacy' }), 'nvk_legacy');
  assert.equal(extractToken({}), '');
  assert.equal(extractToken({ 'x-noviscia-app-token': '   ' }), '');
});

test('scope validation accepts only the declared scopes', () => {
  for (const s of TOKEN_SCOPES) assert.ok(isValidScope(s), `${s} valid`);
  assert.equal(isValidScope('readwrite'), false);
  assert.equal(isValidScope(''), false);
});