import { createHash } from 'node:crypto';

/**
 * A hash of the values the action pushes to a node. The next push compares
 * it with the hash stored on the node instead of the stored values, which
 * Jahia rewrites when it saves them: a richtext link, for one, is stored in a
 * form the action never sent.
 */
export const fingerprint = (values: Record<string, unknown>) =>
  createHash('sha256')
    .update(JSON.stringify(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
    .digest('hex');

/** One node the action pushed, and its publication status in one language. */
export type NodeStatus = {
  /** What the node is to the document: its "page" or its "content". */
  role: string;
  path: string;
  /** A value of the `PublicationStatus` GraphQL enum, such as `MODIFIED`. */
  status: string;
};

/** The publication status of the nodes of one pushed file, or why it is unknown. */
export type FileStatus = {
  file: string;
  language: string;
  /** Where an editor opens the document in jContent. */
  link: string;
  nodes?: NodeStatus[];
  error?: string;
};

/** Host of the Academy edit server, where editors open a page in jContent. */
export const EDIT_HOST = 'https://edit.jahia.com';

/**
 * The jContent URL of a node: `/sites/academy/home/a/b` in `en` opens at
 * `https://edit.jahia.com/jahia/jcontent/academy/en/pages/home/a/b`.
 */
export const jcontentLink = (path: string, language: string) => {
  const [, site, ...rest] = path.match(/^\/sites\/([^/]+)\/(.*)$/) ?? [];
  if (!site) return '';
  return `${EDIT_HOST}/jahia/jcontent/${site}/${language}/pages/${rest.join('')}`;
};

/** Ends the log line of a pushed file whose content the live site does not show yet. */
export const UNPUBLISHED_NOTE = '📝 Unpublished content';

/** Ends the log line of a pushed file whose publication status could not be read. */
export const UNKNOWN_NOTE = '❔ Publication status unknown';

/**
 * Every status other than PUBLISHED means the live site does not show what is
 * in the edit workspace: a new node (NOT_PUBLISHED), a change (MODIFIED), an
 * unpublished node (UNPUBLISHED), and so on.
 */
export const pendingNodes = (nodes: NodeStatus[]) =>
  nodes.filter(({ status }) => status !== 'PUBLISHED');

/**
 * True when the live site does not show the content of the document. Only
 * the content node counts: its page can hold other content, which the action
 * does not manage.
 */
export const isUnpublished = ({ nodes }: FileStatus) =>
  nodes !== undefined && pendingNodes(nodes.filter(({ role }) => role === 'content')).length > 0;

/**
 * The log line of a pushed file, a single line, with a note when the content
 * is not live or its status is unknown. The jContent link is in the status
 * table only: a log shows a URL in full, which is too long for this line.
 */
export const processedLine = (status: FileStatus) => {
  const line = `✅ Successfully processed "${status.file}"`;
  if (status.error !== undefined) return `${line} - ${UNKNOWN_NOTE}`;
  if (isUnpublished(status)) return `${line} - ${UNPUBLISHED_NOTE}`;
  return line;
};

/**
 * The publication status of every pushed file, as the lines of a text table
 * with aligned columns.
 */
export const statusTable = (files: FileStatus[]): string[] => {
  const header = ['File', 'Language', 'Page', 'Content', 'Live site', 'Link'];
  const rows = files.map((status) => {
    // "-" for a document with no page, "?" when the status could not be read
    const of = (role: string) =>
      status.nodes?.find((node) => node.role === role)?.status ?? (status.error ? '?' : '-');
    const live =
      status.error !== undefined
        ? `unknown: ${status.error}`
        : isUnpublished(status)
          ? 'unpublished content'
          : 'up to date';
    return [status.file, status.language, of('page'), of('content'), live, status.link];
  });

  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length))
  );
  // No line ends with spaces, even when its last cell is empty
  const line = (cells: string[]) =>
    cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ').trimEnd();

  return [line(header), widths.map((width) => '-'.repeat(width)).join('-|-'), ...rows.map(line)];
};
