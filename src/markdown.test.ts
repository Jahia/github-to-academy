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

${code}tsx
// Code blocks are trimmed
// tsx is changed to js
${code}

CMS links are un-escaped: [nice page](/cms/{mode}/{lang}/whatever)

<details><summary>Raw HTML</summary>

I'm hidden right?

</details>

<p>Test raw HTML processing <img src="/absolute.png" alt="" /></p>

:::success
I'm green
:::
:::danger
I'm red
:::
:::warning
I'm orange
:::
:::info
I'm blue
:::
`,
  };
  const expected: Options = {
    data: { matter: { ok: true } },
    value: `<h1>Hello World!</h1>
<p>Relative image path: <img src="http://example.com/path/to/relative.png" alt="alt text"></p>
<pre><code class="language-js">// Code blocks are trimmed
// tsx is changed to js</code></pre>
<p>CMS links are un-escaped: <a href="/cms/{mode}/{lang}/whatever">nice page</a></p>
<details><summary>Raw HTML</summary>
<p>I'm hidden right?</p>
</details>
<p>Test raw HTML processing <img src="http://example.com/absolute.png" alt=""></p>
<div class="alert alert-success"><p>I'm green</p></div>
<div class="alert alert-danger"><p>I'm red</p></div>
<div class="alert alert-warning"><p>I'm orange</p></div>
<div class="alert alert-info"><p>I'm blue</p></div>`,
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
