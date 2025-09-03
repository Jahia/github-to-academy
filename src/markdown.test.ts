import assert, { AssertionError } from 'node:assert/strict';
import test from 'node:test';
import type { Options } from 'vfile';
import { toMarkdown } from './markdown.ts';

test('all custom markdown features', async () => {
  const code = '```';
  const input: Options = {
    data: { url: 'http://example.com/path/to/file.md' },
    value: `---
ok: true
---

# Hello World!

Relative image path: ![alt text](relative.png)

${code}html
<p>
  <strong>Code blocks are trimmed</strong>
</p>
${code}

CMS links are un-escaped: [nice page](/cms/{mode}/{lang}/whatever)

<details><summary>Raw HTML</summary>

I'm hidden right?

</details>

<p>Test raw HTML processing <img src="/absolute.png" alt="" /></p>
`,
  };
  const expected: Options = {
    data: { matter: { ok: true } },
    value: `<h1>Hello World!</h1>
<p>Relative image path: <img src="http://example.com/path/to/relative.png" alt="alt text"></p>
<pre><code class="language-html">&#x3C;p>
  &#x3C;strong>Code blocks are trimmed&#x3C;/strong>
&#x3C;/p></code></pre>
<p>CMS links are un-escaped: <a href="/cms/{mode}/{lang}/whatever">nice page</a></p>
<details><summary>Raw HTML</summary>
<p>I'm hidden right?</p>
</details>
<p>Test raw HTML processing <img src="http://example.com/absolute.png" alt=""></p>`,
  };

  try {
    assert.partialDeepStrictEqual(await toMarkdown(input), expected);
  } catch (error) {
    if (error instanceof AssertionError) {
      console.log(`Output HTML: \`${(error.actual as any).value.replaceAll(/[\\`]/g, '\\$&')}\``);
    }
    throw error;
  }
});
