import * as core from '@actions/core';
import * as github from '@actions/github';
import { Client, fetchExchange } from '@urql/core';
import { graphql } from 'gql.tada';
import * as fs from 'node:fs';
import { dirname, resolve } from 'node:path/posix';
import { inspect } from 'node:util';
import { read } from 'to-vfile';
import * as z from 'zod';
import { deleteIfTypeDiffers, ensureFirstChild, upsertNode } from './api.ts';
import { GITHUB_BANNER_NODE_NAME, githubBannerHtml } from './banner.ts';
import { toMarkdown } from './markdown.ts';
import { isPathNotFound, retry } from './retry.ts';
import { createStickyFetch } from './sticky-fetch.ts';

const defaultPublish = core.getInput('publish') !== 'false';
const defaultLanguage = core.getInput('language') || 'en';
const defaultGithubBanner = core.getInput('github-banner') === 'true';

/**
 * Maximum number of passes over the files. A file can fail because it links
 * to a page that comes later in the same batch: by the next pass that page
 * exists, so retrying the whole file is enough to resolve the ordering.
 */
const MAX_PASSES = 3;

/** Schema to parse the frontmatter in single content node mode. */
const ContentSchema = z.object({
  content: z.looseObject({
    $path: z.string(),
    // We could make the schema "smarter" at the expense of complexity
    // Let's keep it dumb for now
    $type: z.string().default('jacademy:textContent'),
    $body: z.string().default('textContent'),
  }),
});

/** Schema to parse the frontmatter in page and content node mode. */
const PageAndContentSchema = z.object({
  page: z.looseObject({
    $path: z.string(),
    $type: z.string().default('jnt:page'),
  }),
  content: z.looseObject({
    $subpath: z.string(),
    $type: z.string().default('jacademy:textContent'),
    $body: z.string().default('textContent'),
  }),
});

/** Whole frontmatter schema. (with individual overrides) */
const FrontmatterSchema = z
  .object({
    language: z.string().optional().default(defaultLanguage),
    publish: z.boolean().optional().default(defaultPublish),
    githubBanner: z.boolean().optional().default(defaultGithubBanner),
    // Deliberately not configurable at the action level: taking over content
    // that was not pushed by this action must be a per-document decision
    overwrite: z.boolean().optional().default(false),
  })
  .and(ContentSchema.or(PageAndContentSchema));

try {
  // Retrieve input params
  const glob = core.getInput('files', { required: true });
  const graphqlEndpoint = new URL(core.getInput('graphql-endpoint', { required: true }));
  const graphqlAuthorization = core.getInput('graphql-authorization', { required: true });

  const headers: Record<string, string> = {
    Referer: graphqlEndpoint.origin,
    Authorization: graphqlAuthorization,
    'X-GitHub-Action': 'github-to-academy',
  };

  const client = new Client({
    url: graphqlEndpoint.toString(),
    exchanges: [fetchExchange],
    // The Academy is a cluster: stick to one server for the whole run so that
    // freshly created nodes are visible to the requests that follow
    fetch: createStickyFetch(),
    fetchOptions: {
      headers,
    },
  });

  // Ref used in "edit this content on GitHub" links: point to the branch where
  // edits happen (the default branch), not to the immutable commit being pushed
  const editRef =
    (github.context.payload.repository?.default_branch as string | undefined) ??
    github.context.ref.replace(/^refs\/(heads|tags)\//, '');

  const files = fs.globSync(glob).sort();

  core.info(`Found ${files.length} markdown files from glob: "${glob}".`);

  /** Pushes one markdown file to the Academy. Throws on failure. */
  const processFile = async (file: string): Promise<void> => {
    const input = await read(file, { encoding: 'utf8' });

    // Set the raw URL of the document to resolve relative resources (e.g. images)
    input.data.url = `https://raw.githubusercontent.com/${github.context.repo.owner}/${github.context.repo.repo}/${github.context.sha}/${file}`;

    const output = await toMarkdown(input);

    if (Object.keys(output.data.matter ?? {}).length === 0) {
      core.info(`⏩ Skipped "${file}" because it has no frontmatter.`);
      return;
    }

    const html = `<!-- Pushed at ${new Date().toISOString()} from https://github.com/${
      github.context.repo.owner
    }/${github.context.repo.repo}/blob/${github.context.sha}/${file} -->\n${output}`;

    const frontmatter = FrontmatterSchema.parse(output.data.matter);
    const { language, publish, overwrite, content } = frontmatter;

    // If `page` is defined, we need to create/update the page first
    if ('page' in frontmatter) {
      const { $path, $type, ...properties } = frontmatter.page;

      await upsertNode(client, { path: $path, type: $type, properties, language, publish, overwrite });

      // Render the page in edit mode to trigger area creation. A freshly
      // created page may not be visible cluster-wide yet, hence the retry.
      await retry(
        async () => {
          const response = await client.query(
            graphql(
              `
                query ($path: String!, $language: String!) {
                  jcr {
                    nodeByPath(path: $path) {
                      renderedContent(
                        contextConfiguration: "gwt"
                        isEditMode: true
                        language: $language
                        view: "default"
                        templateType: "html"
                      ) {
                        output
                      }
                    }
                  }
                }
              `
            ),
            { path: $path, language }
          );

          if (response.error) throw response.error;
        },
        { shouldRetry: isPathNotFound }
      );
    }

    const path =
      'page' in frontmatter
        ? resolve(frontmatter.page.$path, frontmatter.content.$subpath)
        : frontmatter.content.$path;

    const { $path, $subpath, $type, $body, ...properties } = content;

    // Update or create the content node
    await upsertNode(client, {
      path,
      type: $type,
      properties: { ...properties, [$body]: html },
      publish,
      language,
      overwrite,
    });

    // Optionally maintain a "github-content" banner as the first content of the
    // page, telling editors that this content is managed on GitHub
    if ('page' in frontmatter && frontmatter.githubBanner && frontmatter.page.$type === 'jnt:page') {
      // The banner lives next to the content node
      const bannerParent = dirname(path);
      const bannerPath = resolve(bannerParent, GITHUB_BANNER_NODE_NAME);

      // The banner is fully owned by the action: if an earlier version left
      // it with another type, replace it instead of failing the upsert
      await deleteIfTypeDiffers(client, { path: bannerPath, type: 'jnt:bigText' });

      // jnt:bigText (not jnt:text): its "text" property is a richtext, so
      // the alert markup is rendered as HTML instead of being escaped
      await upsertNode(client, {
        path: bannerPath,
        type: 'jnt:bigText',
        properties: {
          text: githubBannerHtml({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            ref: editRef,
            file,
            sha: github.context.sha,
            date: new Date().toISOString().slice(0, 10),
          }),
          // Keep the banner Work In Progress so it can never reach the live site
          'j:workInProgressStatus': 'ALL_CONTENT',
        },
        language,
        // Never publish the banner, it is only meant for editors
        publish: false,
        // The github-content node is owned by the action by definition
        overwrite: true,
      });

      // Whether the page is new or already existed, the banner must come first
      await ensureFirstChild(client, { parent: bannerParent, name: GITHUB_BANNER_NODE_NAME });
    }

    core.info(`✅ Successfully processed "${file}".`);
  };

  // Pass 1 processes every file; each following pass retries only the files
  // that failed the pass before, until everything succeeds or passes run out
  let pending = files;
  for (let pass = 1; pass <= MAX_PASSES && pending.length > 0; pass++) {
    if (pass > 1) {
      core.info(
        `🔁 Pass ${pass}/${MAX_PASSES}: retrying ${pending.length} file(s) that failed the previous pass.`
      );
    }

    const failed: string[] = [];
    for (const file of pending) {
      try {
        await processFile(file);
      } catch (error) {
        failed.push(file);
        if (pass < MAX_PASSES) {
          // Not an annotation (core.info): the retry may well succeed, e.g.
          // when the failure comes from a link to a page later in the batch
          core.startGroup(`⚠️ Failed to process "${file}" on pass ${pass}/${MAX_PASSES}, will retry.`);
          core.info(inspect(error));
        } else {
          core.startGroup(`❌ Failed to process "${file}" after ${MAX_PASSES} passes, giving up.`);
          core.error(inspect(error));
        }
        core.endGroup();
      }
    }
    pending = failed;
  }

  if (pending.length > 0) {
    core.error(
      `❌ ${pending.length} of ${files.length} file(s) could not be processed after ${MAX_PASSES} passes: ${pending
        .map((file) => `"${file}"`)
        .join(', ')}.`
    );
  } else {
    core.info(`🏁 All ${files.length} file(s) processed successfully.`);
  }
} catch (error) {
  core.setFailed((error as Error).message);
}
