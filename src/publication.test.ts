import assert from 'node:assert/strict';
import test from 'node:test';
import { fingerprint, jcontentLink, pendingNodes, processedLine, statusTable } from './publication.ts';

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

const LINK = 'https://edit.jahia.com/jahia/jcontent/academy/en/pages/home/p';

test('the jContent link drops /sites/<site>/ and keeps the rest of the path', () => {
  assert.equal(jcontentLink('/sites/academy/home/p', 'en'), LINK);
  assert.equal(
    jcontentLink('/sites/academy/home/a/b', 'fr'),
    'https://edit.jahia.com/jahia/jcontent/academy/fr/pages/home/a/b'
  );
  assert.equal(jcontentLink('/not/a/site/path', 'en'), '');
});

const PUBLISHED = {
  file: 'docs/a.md',
  language: 'en',
  link: '',
  nodes: [{ role: 'content', path: '/a', status: 'PUBLISHED' }],
};
const MODIFIED = {
  file: 'docs/page.md',
  language: 'en',
  link: LINK,
  nodes: [
    { role: 'page', path: '/sites/academy/home/p', status: 'MODIFIED' },
    { role: 'content', path: '/sites/academy/home/p/area/c', status: 'MODIFIED' },
  ],
};
const PAGE_ONLY = {
  file: 'docs/other.md',
  language: 'en',
  link: LINK,
  nodes: [
    { role: 'page', path: '/sites/academy/home/p', status: 'MODIFIED' },
    { role: 'content', path: '/sites/academy/home/p/area/c', status: 'PUBLISHED' },
  ],
};
const UNKNOWN = { file: 'docs/b.md', language: 'fr', link: '', error: 'timeout' };

test('the log line of a file is one line, with its note and no link', () => {
  assert.equal(processedLine(PUBLISHED), '✅ Successfully processed "docs/a.md"');
  assert.equal(
    processedLine(MODIFIED),
    '✅ Successfully processed "docs/page.md" - 📝 Unpublished content'
  );
  assert.equal(processedLine(UNKNOWN), '✅ Successfully processed "docs/b.md" - ❔ Publication status unknown');
});

test('a modified page alone is not unpublished content', () => {
  assert.equal(processedLine(PAGE_ONLY), '✅ Successfully processed "docs/other.md"');
});

test('the status table aligns its columns', () => {
  assert.deepEqual(statusTable([PUBLISHED, MODIFIED, UNKNOWN]), [
    'File         | Language | Page     | Content      | Live site           | Link',
    '-------------|----------|----------|--------------|---------------------|-' + '-'.repeat(LINK.length),
    'docs/a.md    | en       | -        | ✅ PUBLISHED | up to date          |',
    `docs/page.md | en       | MODIFIED | MODIFIED     | unpublished content | ${LINK}`,
    'docs/b.md    | fr       | ?        | ?            | unknown: timeout    |',
  ]);
});
