import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'node:fs';
import { read } from 'to-vfile';
import { toMarkdown } from './markdown.ts';
import * as z from 'zod';
import type { FormattedExecutionResult } from 'graphql';

const defaultPublish = core.getInput('publish') !== 'false';
const defaultLanguage = core.getInput('language') || 'en';

/** Schema to parse the frontmatter in single content node mode. */
const ContentSchema = z.object({
  content: z.looseObject({
    $path: z.string(),
    // We could make the schema "smarter" at the expense of complexity
    // Let's keep it dumb for now
    $type: z.string().default('jnt:bigText'),
    $html: z.string().default('text'),
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
    $type: z.string().default('jnt:bigText'),
    $html: z.string().default('text'),
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

  const files = fs.globSync(glob);

  core.info(`Found ${files.length} markdown files from glob: "${glob}".`);

  for (const file of files) {
    try {
      const input = await read(file, { encoding: 'utf8' });

      // Set the raw URL of the document to resolve relative resources (e.g. images)
      input.data.raw = `https://raw.githubusercontent.com/${github.context.repo.owner}/${github.context.repo.repo}/${github.context.sha}/${file}`;

      const output = await toMarkdown(input);
      const html = String(output);

      const matter = FrontmatterSchema.parse(output.data.matter);

      const response = await fetch(graphqlEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Referer: graphqlEndpoint.origin,
          Authorization: graphqlAuthorization,
        },
        body: JSON.stringify({
          query: /* GraphQL */ `
            mutation ($path: String!, $value: String!, $publish: Boolean!, $language: String!) {
              edit: jcr(workspace: EDIT) {
                mutateNode(pathOrId: $path) {
                  mutateProperty(name: "textContent") {
                    setValue(value: $value, language: $language)
                  }
                }
              }
              publish: jcr(workspace: EDIT) @include(if: $publish) {
                mutateNode(pathOrId: $path) {
                  publish(languages: [$language])
                }
              }
            }
          `,
          variables: {
            path: matter.content.$path,
            value: html,
            publish: matter.publish,
            language: matter.language,
          },
        }),
      });

      const { data, errors } = response.json() as FormattedExecutionResult<{
        edit: { mutateNode: { mutateProperty: { setValue: boolean } } };
        publish?: { mutateNode: { publish: boolean } };
      }>;

      if (errors) throw errors;

      if (!data?.edit.mutateNode.mutateProperty.setValue) throw new Error(`Failed to update node.`);
      if (matter.publish && !data?.publish?.mutateNode.publish)
        throw new Error(`Failed to publish node.`);

      core.info(`✅ Successfully processed "${file}".`);
    } catch (error) {
      core.startGroup(`❌ Failed to process "${file}".`);
      console.error(error);
      core.endGroup();
    }
  }

  // Get the JSON webhook payload for the event that triggered the workflow
  const payload = JSON.stringify(github.context.payload, undefined, 2);
  core.info(`The event payload: ${payload}`);
} catch (error) {
  core.setFailed((error as Error).message);
}
