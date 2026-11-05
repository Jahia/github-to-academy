import assert from 'node:assert/strict';
import test from 'node:test';
import { describePending, fingerprint, pendingNodes } from './publication.ts';

test('the fingerprint does not depend on the order of the properties', () => {
  assert.equal(
    fingerprint({ 'jcr:title': 'Upgrade', textContent: '<p>Hello</p>' }),
    fingerprint({ textContent: '<p>Hello</p>', 'jcr:title': 'Upgrade' })
  );
});

test('a changed value changes the fingerprint', () => {
  assert.notEqual(
    fingerprint({ textContent: '<p>Hello</p>' }),
    fingerprint({ textContent: '<p>Hello, world</p>' })
  );
});

test('a renamed property changes the fingerprint', () => {
  assert.notEqual(fingerprint({ a: 'x' }), fingerprint({ b: 'x' }));
});

test('every status other than PUBLISHED is pending', () => {
  const nodes = [
    { role: 'page', path: '/p', status: 'PUBLISHED' },
    { role: 'content', path: '/p/c', status: 'MODIFIED' },
    { role: 'other', path: '/p/o', status: 'NOT_PUBLISHED' },
  ];
  assert.deepEqual(
    pendingNodes(nodes).map(({ role }) => role),
    ['content', 'other']
  );
  assert.equal(describePending(pendingNodes(nodes)), 'content is MODIFIED, other is NOT_PUBLISHED');
});
