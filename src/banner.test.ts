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
  assert.ok(
    html.includes(
      '<a href="https://github.com/Jahia/academy-docs/blob/main/security/security-advisories/jsa-2026-test.md">'
    )
  );

  // The node name is part of the action's contract, guard against accidental renames
  assert.equal(GITHUB_BANNER_NODE_NAME, 'github-content');
});
