import type * as hast from 'hast';
import type * as mdast from 'mdast';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { VFileCompatible } from 'vfile';
import { matter } from 'vfile-matter';

declare module 'vfile' {
  interface DataMap {
    /** URL to the raw file on GitHub. Starts with `https://raw.githubusercontent.com/`. */
    url: string;
    /** Markdown frontmatter. */
    matter: NonNullable<unknown>;
  }
}
const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(remarkDirective)
  .use(() => (tree: mdast.Root) => {
    visit(tree, (node) => {
      if (node.type === 'containerDirective') {
        if (!['success', 'danger', 'warning', 'info'].includes(node.name))
          throw new Error(`Unknown container directive :::${node.name}`);
        node.data ??= {};
        node.data.hName = 'div';
        node.data.hProperties = { className: ['alert', 'alert-' + node.name] };
      }
    });
  })
  .use(() => (tree, file) => matter(file))
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(() => (tree: hast.Root, file) => {
    visit(tree, 'element', (node) => {
      // Resolve all relative image paths
      if (node.tagName === 'img') {
        const src = node.properties.src;
        if (typeof src === 'string') {
          node.properties.src = new URL(src, file.data.url).href;
        }
      }

      // Trim code nodes
      if (node.tagName === 'code') {
        if (node.children.length === 1 && node.children[0].type === 'text') {
          node.children[0].value = node.children[0].value.trim();
        }

        if (Array.isArray(node.properties.className)) {
          node.properties.className = node.properties.className.map((className) =>
            className === 'language-ts' || className === 'language-tsx' ? 'language-js' : className
          );
        }
      }

      // Fix link placeholders ({mode} and {lang})
      if (node.tagName === 'a' && typeof node.properties.href === 'string') {
        node.properties.href = node.properties.href
          .replaceAll('%7Bmode%7D', '{mode}')
          .replaceAll('%7Blang%7D', '{lang}');
      }
    });
  })
  .use(rehypeStringify);

export const toMarkdown = (file: VFileCompatible) => processor.process(file);
