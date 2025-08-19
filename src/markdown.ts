import { Root } from 'hast';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import { matter } from 'vfile-matter';

declare module 'vfile' {
  interface DataMap {
    /** URL to the raw file on GitHub. Starts with `https://raw.githubusercontent.com/`. */
    raw: string;
    /** Markdown frontmatter. */
    matter: NonNullable<unknown>;
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(() => (tree, file) => matter(file))
  .use(remarkRehype)
  .use(() => (tree: Root, file) => {
    visit(tree, 'element', (node) => {
      // Resolve all relative image paths
      if (node.tagName === 'img') {
        const src = node.properties.src;
        if (typeof src === 'string') {
          node.properties.src = new URL(src, file.data.raw).href;
        }
      }

      // Trim code nodes
      if (node.tagName === 'code') {
        if (node.children.length === 1 && node.children[0].type === 'text') {
          node.children[0].value = node.children[0].value.trim();
        }
      }
    });
  })
  .use(rehypeStringify);

export const toMarkdown = (file: VFile) => processor.process(file);
