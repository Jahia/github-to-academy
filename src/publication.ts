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

/**
 * Every status other than PUBLISHED means the live site does not show what is
 * in the edit workspace: a new node (NOT_PUBLISHED), a change (MODIFIED), an
 * unpublished node (UNPUBLISHED), and so on.
 */
export const pendingNodes = (nodes: NodeStatus[]) =>
  nodes.filter(({ status }) => status !== 'PUBLISHED');

/** "page is NOT_PUBLISHED, content is MODIFIED" */
export const describePending = (nodes: NodeStatus[]) =>
  nodes.map(({ role, status }) => `${role} is ${status}`).join(', ');
