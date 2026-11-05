import assert from 'node:assert/strict';
import test from 'node:test';
import { fingerprint, pendingNodes, processedLine, statusTable } from './publication.ts';

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
});

const PUBLISHED = { file: 'docs/a.md', language: 'en', nodes: [{ role: 'content', path: '/a', status: 'PUBLISHED' }] };
const MODIFIED = {
  file: 'docs/page.md',
  language: 'en',
  nodes: [{ role: 'content', path: '/p/c', status: 'MODIFIED' }],
};
const UNKNOWN = { file: 'docs/b.md', language: 'fr', error: 'timeout' };

test('the log line of a file is one line, with a note at its end', () => {
  assert.equal(processedLine(PUBLISHED), '✅ Successfully processed "docs/a.md".');
  assert.equal(processedLine(MODIFIED), '✅ Successfully processed "docs/page.md" - 📝 Unpublished content');
  assert.equal(processedLine(UNKNOWN), '✅ Successfully processed "docs/b.md" - ❔ Publication status unknown');
});

test('the status table aligns its columns', () => {
  assert.deepEqual(statusTable([PUBLISHED, MODIFIED, UNKNOWN]), [
    'File         | Language | Content   | Live site',
    '-------------|----------|-----------|--------------------',
    'docs/a.md    | en       | PUBLISHED | up to date',
    'docs/page.md | en       | MODIFIED  | unpublished content',
    'docs/b.md    | fr       | ?         | unknown: timeout',
  ]);
});
