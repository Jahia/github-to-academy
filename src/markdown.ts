import type * as hast from 'hast';
import type * as mdast from 'mdast';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { directive } from 'micromark-extension-directive';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
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
    matter: unknown;
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(function remarkDirective() {
    // Workaround until https://github.com/micromark/micromark-extension-directive/issues/31 is fixed
    const data = this.data();
    const { flow } = directive();
    // @ts-expect-error flow is a generic extension, not the specific return object
    (data.micromarkExtensions ??= []).push({ flow: { [58]: flow[58][0] } });
    (data.fromMarkdownExtensions ??= []).push(directiveFromMarkdown());
  })
  .use(() => (tree: mdast.Root) => {
    visit(tree, 'containerDirective', (node) => {
      if (!['success', 'danger', 'warning', 'info'].includes(node.name))
        throw new Error(`Unknown container directive :::${node.name}`);
      node.data ??= {};
      node.data.hName = 'div';
      node.data.hProperties = { className: ['alert', 'alert-' + node.name] };
    });
  })
  .use(() => (_, file) => matter(file))
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(() => (tree: hast.Root, file) => {
    visit(tree, 'element', (node, index, parent) => {
      // Resolve all relative image paths
      if (node.tagName === 'img') {
        const src = node.properties.src;
        if (typeof src === 'string') {
          node.properties.src = new URL(src, file.data.url).href;
        }

        // If the image is the only child of its parent paragraph, we wrap it in a link for lightboxing
        // Reference: https://github.com/Jahia/jahia-academy-template/blob/2ace39197c27fdd7c762b7aca0dba9e942436c13/src/main/java/org/jahia/modules/academy/filters/AcademyImageUrlRewriter.java#L83-L92
        if (
          index === 0 &&
          parent?.type === 'element' &&
          parent?.tagName === 'p' &&
          parent.children.length === 1
        ) {
          node.properties.className = ['figure-img', 'img-fluid', 'rounded', 'shadow'];
          parent.tagName = 'figure';
          parent.properties.className = ['figure'];
          parent.children = [
            {
              type: 'element',
              tagName: 'a',
              properties: {
                href: node.properties.src,
                'data-toggle': 'lightbox',
                'data-gallery': 'doc-images',
              },
              children: [node],
            },
          ];
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

      // Remove the ugly asymmetric margin in alert divs
      // Reference: https://github.com/twbs/bootstrap/blob/0458e76ec1e51c3b8edcecfeb43feea58143f36d/scss/_reboot.scss#L131
      if (
        node.tagName === 'p' &&
        parent?.type === 'element' &&
        parent?.tagName === 'div' &&
        // Only change the last paragraph of the alert
        index === parent.children.length - 1 &&
        Array.isArray(parent.properties.className) &&
        parent.properties.className.includes('alert')
      ) {
        node.properties.style = 'margin-bottom:0';
      }
    });
  })
  .use(rehypeStringify);

export const toMarkdown = (file: VFileCompatible) => processor.process(file);
