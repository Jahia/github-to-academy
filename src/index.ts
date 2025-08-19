import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'node:fs';
import { read } from 'to-vfile';
import { toMarkdown } from './markdown.ts';
import * as z from 'zod';
import type { FormattedExecutionResult } from 'graphql';

try {
  // Retrieve input params
  const glob = core.getInput('files', { required: true });
  const graphqlEndpoint = new URL(core.getInput('graphql-endpoint', { required: true }));
  const graphqlAuthorization = core.getInput('graphql-authorization', { required: true });

  const defaultPublish = core.getInput('publish') !== 'false';
  const defaultLanguage = core.getInput('language');

  const files = fs.globSync(glob);

  core.info(`Found ${files.length} markdown files from glob: "${glob}".`);

  for (const file of files) {
    try {
      const input = await read(file, { encoding: 'utf8' });
      input.data.raw = `https://raw.githubusercontent.com/${github.context.repo.owner}/${github.context.repo.repo}/${github.context.sha}/${file}`;
      const output = await toMarkdown(input);
      const html = String(output);

      const matter = z
        .object({
          path: z.string(),
          language: z.string().optional().default(defaultLanguage),
          publish: z.boolean().optional().default(defaultPublish),
        })
        .parse(output.data.matter);

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
            path: matter.path,
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
  core.setFailed(error.message);
}
