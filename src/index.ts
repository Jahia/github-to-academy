import * as core from '@actions/core';
import * as github from '@actions/github';
import { Client, fetchExchange } from '@urql/core';
import { graphql } from 'gql.tada';
import * as fs from 'node:fs';
import { resolve } from 'node:path/posix';
import { inspect } from 'node:util';
import { read } from 'to-vfile';
import * as z from 'zod';
import { deleteIfTypeDiffers, ensureFirstChild, getPublicationStatus, upsertNode } from './api.ts';
import { githubBannerHtml } from './banner.ts';
import { invalidLinkHints } from './hints.ts';
import { toMarkdown } from './markdown.ts';
import {
  isUnpublished,
  jcontentLink,
  processedLine,
  statusTable,
  type FileStatus,
  type NodeStatus,
} from './publication.ts';

const GITHUB_BANNER_NODE_NAME = 'github-banner';

const defaultPublish = core.getInput('publish') !== 'false';
const defaultLanguage = core.getInput('language') || 'en';
const defaultGithubBanner = core.getInput('github-banner') !== 'false';

/** Schema to parse the frontmatter in single content node mode. */
const ContentSchema = z.object({
  content: z.looseObject({
    $path: z.string(),
    // We could make the schema "smarter" at the expense of complexity
    // Let's keep it dumb for now
    $type: z.string().default('jacademy:textContent'),
    $mixins: z.array(z.string()).default([]),
    $body: z.string().default('textContent'),
  }),
});

/** Schema to parse the frontmatter in page and content node mode. */
const PageAndContentSchema = z.object({
  page: z.looseObject({
    $path: z.string(),
    $type: z.string().default('jnt:page'),
    $mixins: z.array(z.string()).default([]),
  }),
  content: z.looseObject({
    $subpath: z.string(),
    $type: z.string().default('jacademy:textContent'),
    $mixins: z.array(z.string()).default([]),
    $body: z.string().default('textContent'),
  }),
});

/** Whole frontmatter schema. (with individual overrides) */
const FrontmatterSchema = z
  .object({
    language: z.string().optional().default(defaultLanguage),
    publish: z.boolean().optional().default(defaultPublish),
    githubBanner: z.boolean().optional().default(defaultGithubBanner),
  })
  .and(ContentSchema.or(PageAndContentSchema));

try {
  // Retrieve input params
  // One glob per line, so a workflow can pass just the files a push actually
  // changed instead of re-pushing every document on every run.
  const patterns = core
    .getInput('files', { required: true })
    .split('\n')
    .map((pattern) => pattern.trim())
    .filter(Boolean);
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
    // urql sends queries as GET by default; Jahia expects every request as POST
    preferGetMethod: false,
    fetchOptions: {
      headers,
    },
  });

  // Patterns may overlap, and a file pushed twice in one run would be a wasted
  // write and a confusing count
  const files = [...new Set(fs.globSync(patterns))].sort();

  core.info(
    `Found ${files.length} markdown files from ${
      patterns.length === 1 ? `glob: "${patterns[0]}"` : `${patterns.length} patterns`
    }.`
  );

  // A file that cannot be pushed must fail the job. Every file is still
  // attempted, so one bad document does not hide the state of the others.
  const failures: string[] = [];
  let pushed = 0;
  let skipped = 0;
  /** The publication status of every file pushed, in the order of the push. */
  const publicationStatuses: FileStatus[] = [];

  /**
   * Reads the publication status of the nodes a file pushed, and logs the
   * file on one line, with a note when its content is not live yet. A failure
   * to read a status does not fail the file: its content is already pushed.
   */
  const reportPublication = async (
    file: string,
    nodes: Omit<NodeStatus, 'status'>[],
    language: string,
    link: string
  ) => {
    let status: FileStatus;
    try {
      status = {
        file,
        language,
        link,
        nodes: await Promise.all(
          nodes.map(async (node) => ({
            ...node,
            status: await getPublicationStatus(client, { path: node.path, language }),
          }))
        ),
      };
    } catch (error) {
      status = { file, language, link, error: (error as Error).message };
    }
    publicationStatuses.push(status);
    core.info(processedLine(status));
  };

  for (const file of files) {
    try {
      const input = await read(file, { encoding: 'utf8' });

      // Set the raw URL of the document to resolve relative resources (e.g. images)
      input.data.url = `https://raw.githubusercontent.com/${github.context.repo.owner}/${github.context.repo.repo}/${github.context.sha}/${file}`;

      const output = await toMarkdown(input);

      if (Object.keys(output.data.matter ?? {}).length === 0) {
        core.info(`⏩ Skipped "${file}" because it has no frontmatter.`);
        skipped++;
        continue;
      }

      const html = `<!-- Pushed at ${new Date().toISOString()} from https://github.com/${
        github.context.repo.owner
      }/${github.context.repo.repo}/blob/${github.context.sha}/${file} -->\n${output}`;

      const frontmatter = FrontmatterSchema.parse(output.data.matter);
      const { language, publish, content } = frontmatter;

      // If `page` is defined, we need to create/update the page first
      if ('page' in frontmatter) {
        const { $path, $type, $mixins, ...properties } = frontmatter.page;

        await upsertNode(client, {
          path: $path,
          type: $type,
          mixins: $mixins,
          properties,
          language,
          publish,
        });

        // Render the page in edit mode to trigger area creation
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
      }

      const path =
        'page' in frontmatter
          ? resolve(frontmatter.page.$path, frontmatter.content.$subpath)
          : frontmatter.content.$path;

      const { $path, $subpath, $type, $mixins, $body, ...properties } = content;

      // Update or create the content node
      await upsertNode(client, {
        path,
        type: $type,
        mixins: $mixins,
        properties: { ...properties, [$body]: html },
        publish,
        language,
        // The body starts with a stamp that changes on every push: leave it
        // out, so an unchanged document is not rewritten
        fingerprintOf: { ...properties, [$body]: String(output) },
      });

      // Optionally maintain the "github-banner" node as the first content of the
      // page, telling editors that this content is managed on GitHub
      if (
        'page' in frontmatter &&
        frontmatter.githubBanner &&
        frontmatter.page.$type === 'jnt:page'
      ) {
        // The banner lives next to the content node
        const area = resolve(path, '..');
        const bannerPath = resolve(area, GITHUB_BANNER_NODE_NAME);

        // Remove the banner if not a rich text node
        await deleteIfTypeDiffers(client, { path: bannerPath, type: 'jnt:bigText' });

        await upsertNode(client, {
          path: bannerPath,
          type: 'jnt:bigText',
          properties: {
            text: githubBannerHtml(file),
            // Keep the banner Work In Progress so it can never reach the live site
            'j:workInProgressStatus': 'ALL_CONTENT',
          },
          language,
          publish: false,
        });

        await ensureFirstChild(client, { parent: area, name: GITHUB_BANNER_NODE_NAME });
      }

      await reportPublication(
        file,
        // The page status is only shown: whether the document is live depends
        // on its content node alone, as the page can hold other content
        [
          ...('page' in frontmatter ? [{ role: 'page', path: frontmatter.page.$path }] : []),
          { role: 'content', path },
        ],
        language,
        jcontentLink('page' in frontmatter ? frontmatter.page.$path : path, language)
      );
      pushed++;
    } catch (error) {
      core.startGroup(`❌ Failed to process "${file}".`);
      core.error(inspect(error));
      core.endGroup();
      // Outside the group, and as annotations on the file, so the hint is the
      // first thing read in the log and in the run summary
      for (const hint of invalidLinkHints(error)) core.error(`💡 ${hint}`, { file });
      failures.push(file);
    }
  }

  if (publicationStatuses.length > 0) {
    const unpublished = publicationStatuses.filter(isUnpublished).length;
    core.info(
      `📝 ${unpublished} of ${publicationStatuses.length} pushed file(s) need publishing in the Academy.`
    );
    // Collapsed in the log: the details are there for those who investigate
    core.startGroup(`📋 Publication status of the ${publicationStatuses.length} pushed file(s)`);
    for (const line of statusTable(publicationStatuses)) core.info(line);
    core.endGroup();
  }

  core.info(
    `Processed ${files.length} markdown files: ${pushed} pushed, ` +
      `${skipped} skipped, ${failures.length} failed.`
  );

  // core.error only writes an annotation; without this the job would be green
  // while nothing reached the Academy
  if (failures.length > 0)
    core.setFailed(
      `${failures.length} of ${files.length} markdown files could not be pushed ` +
        `to the Academy: ${failures.join(', ')}. See the grouped errors above.`
    );
} catch (error) {
  core.setFailed((error as Error).message);
}
