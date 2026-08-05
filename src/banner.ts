/**
 * Name of the banner node created inside pages when the `github-banner` input
 * is enabled. Also used to check its position on pages that already exist.
 */
export const GITHUB_BANNER_NODE_NAME = 'github-content';

/**
 * HTML content of the banner node: an informational alert telling editors that
 * the content is managed on GitHub, with a link to the source markdown file.
 */
export const githubBannerHtml = ({
  owner,
  repo,
  ref,
  file,
}: {
  owner: string;
  repo: string;
  ref: string;
  file: string;
}) => {
  const repoUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const fileUrl = `${repoUrl}/blob/${encodePath(ref)}/${encodePath(file)}`;
  return `<div class="alert alert-info">
    This content is managed on GitHub and pushed to the Academy automatically: any change made directly in Jahia will be overwritten. To edit this content, modify <a href="${escapeHtml(fileUrl)}">${escapeHtml(file)}</a> in <a href="${escapeHtml(repoUrl)}">${escapeHtml(`${owner}/${repo}`)}</a> instead.
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
