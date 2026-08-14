import assert from 'node:assert/strict';
import test from 'node:test';
import { githubBannerHtml } from './banner.ts';

test('github banner html', () => {
  const html = githubBannerHtml({
    owner: 'Jahia',
    repo: 'academy-docs',
    ref: 'main',
    file: 'security/security-advisories/jsa-2026-test.md',
    sha: 'abc1234def567890000000000000000000000000',
    date: '2026-08-05',
  });

  assert.ok(html.startsWith('<div class="alert alert-info">'));
  assert.ok(html.trimEnd().endsWith('</div>'));
  assert.ok(
    html.includes(
      '<a href="https://github.com/Jahia/academy-docs/blob/main/security/security-advisories/jsa-2026-test.md">security/security-advisories/jsa-2026-test.md</a>'
    )
  );
  assert.ok(html.includes(' in <a href="https://github.com/Jahia/academy-docs">Jahia/academy-docs</a>'));
  assert.ok(
    html.includes(
      'Last pushed on 2026-08-05 from commit <a href="https://github.com/Jahia/academy-docs/commit/abc1234def567890000000000000000000000000">abc1234</a>.'
    )
  );
});

test('github banner html escapes and encodes special characters', () => {
  const html = githubBannerHtml({
    owner: 'Jahia',
    repo: 'academy-docs',
    ref: 'feat/#42',
    file: 'docs/a&b "c".md',
    sha: 'abc1234def567890000000000000000000000000',
    date: '2026-08-05',
  });

  // URL segments are percent-encoded, visible text is HTML-escaped
  assert.ok(html.includes('/blob/feat/%2342/docs/a%26b%20%22c%22.md"'));
  assert.ok(html.includes('>docs/a&amp;b &quot;c&quot;.md</a>'));
  assert.ok(!html.includes('a&b "c".md</a>'));
});
