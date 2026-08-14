import assert from 'node:assert/strict';
import test from 'node:test';

// github.context is hydrated from the environment when @actions/github is first
// imported, so the fixture has to be set before banner.ts pulls it in
process.env.GITHUB_REPOSITORY = 'Jahia/academy-docs';
process.env.GITHUB_SHA = 'abc1234def567890000000000000000000000000';
process.env.GITHUB_REF = 'refs/heads/main';

const { githubBannerHtml } = await import('./banner.ts');

test('github banner html', () => {
  const html = githubBannerHtml('security/security-advisories/jsa-2026-test.md');

  assert.ok(html.startsWith('<div class="alert alert-info">'));
  assert.ok(html.trimEnd().endsWith('</div>'));
  assert.ok(
    html.includes(
      '<a href="https://github.com/Jahia/academy-docs/blob/main/security/security-advisories/jsa-2026-test.md">security/security-advisories/jsa-2026-test.md</a>'
    )
  );
  assert.ok(html.includes(' in <a href="https://github.com/Jahia/academy-docs">Jahia/academy-docs</a>'));
  assert.match(
    html,
    /Last pushed on \d{4}-\d{2}-\d{2} from commit <a href="https:\/\/github\.com\/Jahia\/academy-docs\/commit\/abc1234def567890000000000000000000000000">abc1234<\/a>\./
  );
});

test('github banner html escapes and encodes special characters', () => {
  const html = githubBannerHtml('docs/a&b "c".md');

  // URL segments are percent-encoded, visible text is HTML-escaped
  assert.ok(html.includes('/blob/main/docs/a%26b%20%22c%22.md"'));
  assert.ok(html.includes('>docs/a&amp;b &quot;c&quot;.md</a>'));
  assert.ok(!html.includes('a&b "c".md</a>'));
});
