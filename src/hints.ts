/**
 * Hints that explain an error Jahia returned in terms the author of the
 * markdown file can act on. Jahia only says what it refused, not why.
 */

/**
 * Jahia rejects a richtext that links to a path it cannot resolve with a
 * `GqlConstraintViolationException` whose message reads
 * `<node> Text: Invalid link<path>`, with no space before the path.
 */
const INVALID_LINK = /Invalid link\s*(\S+)/g;

/** Hints for every invalid link named in `error`, without duplicates. */
export const invalidLinkHints = (error: unknown): string[] => {
  const message = error instanceof Error ? error.message : String(error);
  const links = new Set([...message.matchAll(INVALID_LINK)].map(([, link]) => link));

  return [...links].map((link) => {
    const lastSegment = link.split(/[?#]/)[0].split('/').pop() ?? '';

    // A link to a page is its JCR path followed by ".html"
    if (!lastSegment.includes('.'))
      return (
        `Jahia refused the link "${link}". A link to an Academy page must end with ".html": ` +
        `write "${link}.html".`
      );

    return (
      `Jahia refused the link "${link}": nothing exists at this path. Check the path, ` +
      'or push the page it targets first.'
    );
  });
};
