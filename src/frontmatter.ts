/**
 * Whether a document's frontmatter asks for a push to the Academy: it holds a `content` or a `page` block.
 * A document without frontmatter, or whose frontmatter serves another tool (an ADR's `status` and `date`),
 * is left alone.
 */
export const isAcademyFrontmatter = (matter: unknown): boolean =>
  typeof matter === 'object' && matter !== null && ('content' in matter || 'page' in matter);
