import * as github from '@actions/github';

export const githubBannerHtml = (file: string) => {
  const { owner, repo } = github.context.repo;
  const { sha } = github.context;
  const date = new Date().toISOString().slice(0, 10);

  // Link to the branch where edits happen (the default branch), not to the
  // immutable commit being pushed
  const ref =
    (github.context.payload.repository?.default_branch as string | undefined) ??
    github.context.ref.replace(/^refs\/(heads|tags)\//, '');

  const repoUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const fileUrl = `${repoUrl}/blob/${encodePath(ref)}/${encodePath(file)}`;
  const commitUrl = `${repoUrl}/commit/${encodeURIComponent(sha)}`;
  return `<div class="alert alert-info">
    This content is managed on GitHub and pushed to the Academy automatically: any change made directly in Jahia will be overwritten. To edit this content, modify <a href="${escapeHtml(fileUrl)}">${escapeHtml(file)}</a> in <a href="${escapeHtml(repoUrl)}">${escapeHtml(`${owner}/${repo}`)}</a> instead.
    <div style="text-align: right"><small>Last pushed on ${escapeHtml(date)} from commit <a href="${escapeHtml(commitUrl)}">${escapeHtml(sha.slice(0, 7))}</a>.</small></div>
</div>`;
};

/** Escapes a value for use in HTML text and attribute contexts. */
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** URL-encodes a path (branch name, file path) segment by segment. */
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
