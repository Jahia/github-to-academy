import assert from 'node:assert/strict';
import test from 'node:test';
import { GITHUB_BANNER_NODE_NAME, githubBannerHtml } from './banner.ts';

test('github banner html', () => {
  const html = githubBannerHtml({
    owner: 'Jahia',
    repo: 'academy-docs',
    ref: 'main',
    file: 'security/security-advisories/jsa-2026-test.md',
  });

  assert.ok(html.startsWith('<div class="alert alert-info">'));
  assert.ok(html.trimEnd().endsWith('</div>'));

  // The file path links to the file, the "owner/repo" mention to the repository
  assert.ok(
    html.includes(
      '<a href="https://github.com/Jahia/academy-docs/blob/main/security/security-advisories/jsa-2026-test.md">security/security-advisories/jsa-2026-test.md</a>'
    )
  );
  assert.ok(html.includes(' in <a href="https://github.com/Jahia/academy-docs">Jahia/academy-docs</a>'));

  // The node name is part of the action's contract, guard against accidental renames
  assert.equal(GITHUB_BANNER_NODE_NAME, 'github-content');
});

test('github banner html escapes and encodes special characters', () => {
  const html = githubBannerHtml({
    owner: 'Jahia',
    repo: 'academy-docs',
    ref: 'feat/#42',
    file: 'docs/a&b "c".md',
  });

  // URL segments are percent-encoded, visible text is HTML-escaped
  assert.ok(html.includes('/blob/feat/%2342/docs/a%26b%20%22c%22.md"'));
  assert.ok(html.includes('>docs/a&amp;b &quot;c&quot;.md</a>'));
  assert.ok(!html.includes('a&b "c".md</a>'));
});
