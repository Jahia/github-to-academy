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
  nodes?: NodeStatus[];
  error?: string;
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

export const isUnpublished = ({ nodes }: FileStatus) =>
  nodes !== undefined && pendingNodes(nodes).length > 0;

/** The log line of a pushed file: one line, with a note when there is something to know. */
export const processedLine = (status: FileStatus) => {
  const line = `✅ Successfully processed "${status.file}"`;
  if (status.error !== undefined) return `${line} - ${UNKNOWN_NOTE}`;
  if (isUnpublished(status)) return `${line} - ${UNPUBLISHED_NOTE}`;
  return `${line}.`;
};

/**
 * The publication status of every pushed file, as the lines of a text table
 * with aligned columns.
 */
export const statusTable = (files: FileStatus[]): string[] => {
  const header = ['File', 'Language', 'Content', 'Live site'];
  const rows = files.map((status) => {
    const content = status.nodes?.map((node) => node.status).join(', ') ?? '?';
    const live =
      status.error !== undefined
        ? `unknown: ${status.error}`
        : isUnpublished(status)
          ? 'unpublished content'
          : 'up to date';
    return [status.file, status.language, content, live];
  });

  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length))
  );
  // The last column is not padded, so no line ends with spaces
  const line = (cells: string[]) =>
    cells.map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column]))).join(' | ');

  return [line(header), widths.map((width) => '-'.repeat(width)).join('-|-'), ...rows.map(line)];
};
