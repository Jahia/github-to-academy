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
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const fileUrl = `${repoUrl}/blob/${ref}/${file}`;
  return `<div class="alert alert-info">
    This content is managed on GitHub and pushed to the Academy automatically: any change made directly in Jahia will be overwritten. To edit this content, modify <a href="${fileUrl}">${file}</a> in <a href="${repoUrl}">${owner}/${repo}</a> instead.
</div>`;
};
