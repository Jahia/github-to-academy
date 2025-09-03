import * as core from '@actions/core';
import * as github from '@actions/github';
import { Client, fetchExchange } from '@urql/core';
import { graphql } from 'gql.tada';
import * as fs from 'node:fs';
import { resolve } from 'node:path/posix';
import { inspect } from 'node:util';
import { read } from 'to-vfile';
import * as z from 'zod';
import { upsertNode } from './api.ts';
import { toMarkdown } from './markdown.ts';

const defaultPublish = core.getInput('publish') !== 'false';
const defaultLanguage = core.getInput('language') || 'en';

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
  })
  .and(ContentSchema.or(PageAndContentSchema));

try {
  // Retrieve input params
  const glob = core.getInput('files', { required: true });
  const graphqlEndpoint = new URL(core.getInput('graphql-endpoint', { required: true }));
  const graphqlAuthorization = core.getInput('graphql-authorization', { required: true });

  const client = new Client({
    url: graphqlEndpoint.toString(),
    exchanges: [fetchExchange],
    fetchOptions: {
      headers: {
        Referer: graphqlEndpoint.origin,
        Authorization: graphqlAuthorization,
      },
    },
  });

  const files = fs.globSync(glob).sort();

  core.info(`Found ${files.length} markdown files from glob: "${glob}".`);

  for (const file of files) {
    try {
      const input = await read(file, { encoding: 'utf8' });

      // Set the raw URL of the document to resolve relative resources (e.g. images)
      input.data.url = `https://raw.githubusercontent.com/${github.context.repo.owner}/${github.context.repo.repo}/${github.context.sha}/${file}`;

      const output = await toMarkdown(input);

      if (Object.keys(output.data.matter ?? {}).length === 0) {
        core.info(`⏩ Skipped "${file}" because it has no frontmatter.`);
        continue;
      }

      const html = `<!-- Pushed at ${new Date().toISOString()} from https://github.com/${
        github.context.repo.owner
      }/${github.context.repo.repo}/blob/${github.context.sha}/${file} -->\n${output}`;

      const frontmatter = FrontmatterSchema.parse(output.data.matter);
      const { language, publish, content } = frontmatter;

      // If `page` is defined, we need to create/update the page first
      if ('page' in frontmatter) {
        const { $path, $type, ...properties } = frontmatter.page;

        await upsertNode(client, { path: $path, type: $type, properties, language, publish });

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

      const { $path, $subpath, $type, $body, ...properties } = content;

      // Update or create the content node
      await upsertNode(client, {
        path,
        type: $type,
        properties: { ...properties, [$body]: html },
        publish,
        language,
      });

      core.info(`✅ Successfully processed "${file}".`);
    } catch (error) {
      core.startGroup(`❌ Failed to process "${file}".`);
      core.error(inspect(error));
      core.endGroup();
    }
  }
} catch (error) {
  core.setFailed((error as Error).message);
}
