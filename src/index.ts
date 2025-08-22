import * as core from '@actions/core';
import * as github from '@actions/github';
import { Client, fetchExchange } from '@urql/core';
import { graphql } from 'gql.tada';
import assert from 'node:assert';
import * as fs from 'node:fs';
import { basename, dirname, resolve } from 'node:path/posix';
import { inspect } from 'node:util';
import { read } from 'to-vfile';
import * as z from 'zod';
import { toMarkdown } from './markdown.ts';

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
      input.data.raw = `https://raw.githubusercontent.com/${github.context.repo.owner}/${github.context.repo.repo}/${github.context.sha}/${file}`;

      const output = await toMarkdown(input);
      const html = String(output);

      const frontmatter = FrontmatterSchema.parse(output.data.matter);
      const { language, publish, content } = frontmatter;

      // If `page` is defined, we need to create/update the page first
      if ('page' in frontmatter) {
        const { $path, $type, ...rawProperties } = frontmatter.page;
        const properties = Object.entries(rawProperties).map<
          ReturnType<typeof graphql.scalar<'InputJCRProperty'>>
        >(([name, value]) => {
          if (typeof value !== 'string') throw new Error(`Property "${name}" must be a string.`);
          return { name, value, language, type: 'STRING' };
        });

        const { data, error } = await client.query(
          graphql(`
            query ($path: String!) {
              jcr {
                nodeByPath(path: $path) {
                  primaryNodeType {
                    name
                  }
                }
              }
            }
          `),
          { path: $path }
        );

        if (error?.graphQLErrors.some(({ message }) => message.includes('PathNotFoundException'))) {
          // If the page was not found, we create it
          const { error } = await client.mutation(
            graphql(`
              mutation (
                $parent: String!
                $name: String!
                $path: String!
                $type: String!
                $properties: [InputJCRProperty!]!
                $publish: Boolean!
                $language: String!
              ) {
                jcr {
                  addNode(
                    parentPathOrId: $parent
                    name: $name
                    primaryNodeType: $type
                    properties: $properties
                  ) {
                    __typename
                  }
                }
                publish: jcr @include(if: $publish) {
                  mutateNode(pathOrId: $path) {
                    publish(languages: [$language])
                  }
                }
              }
            `),
            {
              parent: dirname($path),
              name: basename($path),
              path: $path,
              type: $type,
              properties,
              publish,
              language,
            }
          );
          if (error) throw error;
          // If the mutation was successful, consider the page created
        } else if (error) {
          // Re-throw all other errors
          throw error;
        } else {
          assert(
            data?.jcr.nodeByPath?.primaryNodeType.name,
            `Node at path "${$path}" has no primary node type.`
          );
          if (data.jcr.nodeByPath.primaryNodeType.name !== $type) {
            throw new Error(
              `Node at path "${$path}" has incompatible type "${data.jcr.nodeByPath.primaryNodeType.name}", expected "${$type}".`
            );
          }

          // At this point, the page exists, update it
          const { error } = await client.mutation(
            graphql(`
              mutation (
                $path: String!
                $properties: [InputJCRProperty!]!
                $publish: Boolean!
                $language: String!
              ) {
                jcr {
                  mutateNode(pathOrId: $path) {
                    setPropertiesBatch(properties: $properties) {
                      __typename
                    }
                  }
                }
                publish: jcr @include(if: $publish) {
                  mutateNode(pathOrId: $path) {
                    publish(languages: [$language])
                  }
                }
              }
            `),
            { path: $path, properties, publish, language }
          );

          if (error) throw error;
        }
      }

      const path =
        'page' in frontmatter
          ? resolve(frontmatter.page.$path, frontmatter.content.$subpath)
          : frontmatter.content.$path;

      const { $path, $subpath, $type, $html, ...rawProperties } = content;
      const properties = Object.entries(rawProperties).map<
        ReturnType<typeof graphql.scalar<'InputJCRProperty'>>
      >(([name, value]) => {
        if (typeof value !== 'string') throw new Error(`Property "${name}" must be a string.`);
        return { name, value, language, type: 'STRING' };
      });

      // Now the parent node, if any, exists, it's time to create/update the content node
      // Does the content node exist?
      const { error } = await client.query(
        graphql(`
          query ($path: String!) {
            jcr {
              nodeByPath(path: $path) {
                primaryNodeType {
                  name
                }
              }
            }
          }
        `),
        { path }
      );

      if (error?.graphQLErrors.some(({ message }) => message.includes('PathNotFoundException'))) {
        // It does not exist, create it
        const { error } = await client.mutation(
          graphql(`
            mutation (
              $parent: String!
              $name: String!
              $path: String!
              $type: String!
              $properties: [InputJCRProperty!]!
              $publish: Boolean!
              $language: String!
            ) {
              jcr {
                addNode(
                  parentPathOrId: $parent
                  name: $name
                  primaryNodeType: $type
                  properties: $properties
                ) {
                  __typename
                }
              }
              publish: jcr @include(if: $publish) {
                mutateNode(pathOrId: $path) {
                  publish(languages: [$language])
                }
              }
            }
          `),
          {
            parent: dirname(path),
            name: basename(path),
            type: content.$type,
            properties,
            publish,
            language,
            path,
          }
        );

        if (error) throw error;
      } else if (error) {
        // Re-throw all other errors
        throw error;
      } else {
        // It exists, update it
        const { error } = await client.mutation(
          graphql(`
            mutation (
              $path: String!
              $properties: [InputJCRProperty!]!
              $publish: Boolean!
              $language: String!
            ) {
              jcr {
                mutateNode(pathOrId: $path) {
                  setPropertiesBatch(properties: $properties) {
                    __typename
                  }
                }
              }
              publish: jcr @include(if: $publish) {
                mutateNode(pathOrId: $path) {
                  publish(languages: [$language])
                }
              }
            }
          `),
          { path, properties, publish, language }
        );

        if (error) throw error;
      }

      core.info(`✅ Successfully processed "${file}".`);
    } catch (error) {
      core.startGroup(`❌ Failed to process "${file}".`);
      core.error(inspect(error));
      core.endGroup();
    }
  }

  // Get the JSON webhook payload for the event that triggered the workflow
  const payload = JSON.stringify(github.context.payload, undefined, 2);
  core.info(`The event payload: ${payload}`);
} catch (error) {
  core.setFailed((error as Error).message);
}
