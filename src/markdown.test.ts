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

![lone images will be lightboxed](lightbox.png)

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

Ensure some directives are NOT processed:

Open localhost:8080.

::ignore
`,
  };
  const expected: Options = {
    data: { matter: { ok: true } },
    value: `<h1>Hello World!</h1>
<p>Relative image path: <img src="http://example.com/path/to/relative.png" alt="alt text"></p>
<figure class="figure"><a href="http://example.com/path/to/lightbox.png" data-toggle="lightbox" data-gallery="doc-images"><img src="http://example.com/path/to/lightbox.png" alt="lone images will be lightboxed" class="figure-img img-fluid rounded shadow"></a></figure>
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
<div class="alert alert-info"><p>I'm blue</p></div>
<p>Ensure some directives are NOT processed:</p>
<p>Open localhost:8080.</p>
<p>::ignore</p>`,
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
