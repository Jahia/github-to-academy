import type { Client } from '@urql/core';
import { graphql } from 'gql.tada';
import assert from 'node:assert/strict';
import { basename, dirname } from 'node:path/posix';

/**
 * Marker property stamped on every node created (or knowingly overwritten) by
 * this action, carried by the jmix:unstructured mixin. Its presence tells
 * subsequent runs the node is managed from GitHub and safe to update; without
 * it, updates are refused unless the document opts in with `overwrite: true`.
 */
export const MANAGED_MARKER = 'githubToAcademyManaged';

/** Inserts or updates a node. */
export const upsertNode = async (
  client: Client,
  {
    path,
    type,
    properties: rawProperties,
    language,
    publish,
    overwrite = false,
  }: {
    path: string;
    type: string;
    properties: Record<string, unknown>;
    language: string;
    publish: boolean;
    /** Allow updating a node that does not carry the MANAGED_MARKER property. */
    overwrite?: boolean;
  }
) => {
  // Fetch the node to see if it exists, if it's of a compatible node type,
  // and whether it is marked as managed by this action
  const { data, error } = await client.query(
    graphql(`
      query ($path: String!, $marker: String!, $language: String!) {
        jcr {
          nodeByPath(path: $path) {
            primaryNodeType {
              name
            }
            property(name: $marker, language: $language) {
              value
            }
          }
        }
      }
    `),
    { path, marker: MANAGED_MARKER, language }
  );

  if (error?.graphQLErrors.some(({ message }) => message.includes('PathNotFoundException'))) {
    // If the node was not found, we create it — with the managed marker, so
    // future runs know this node is owned by the action
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
              mixins: ["jmix:unstructured"]
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
        path,
        type,
        properties: prepareProperties({ ...rawProperties, [MANAGED_MARKER]: 'true' }, language),
        publish,
        language,
      }
    );
    if (error) throw error;

    // If the mutation was successful, consider the node created
  } else if (error) {
    // Re-throw all other errors
    throw error;
  } else {
    assert(
      data?.jcr.nodeByPath?.primaryNodeType.name,
      `Node at path "${path}" has no primary node type.`
    );
    assert.equal(
      data.jcr.nodeByPath.primaryNodeType.name,
      type,
      `Node at path "${path}" has an unexpected node type.`
    );

    // The node exists but does not carry the managed marker: it holds content
    // that was not pushed by this action, refuse to silently overwrite it
    const isManaged = Boolean(data.jcr.nodeByPath.property?.value);
    if (!isManaged && !overwrite) {
      throw new Error(
        `Refusing to update "${path}": this node was not created by github-to-academy. ` +
          'Add "overwrite: true" to the frontmatter of this document to take ownership of it.'
      );
    }

    if (!isManaged) {
      // Take ownership: allow the marker property on this node, it is then
      // stamped by the update below so future runs need no overwrite flag
      const mixin = await client.mutation(
        graphql(`
          mutation ($path: String!) {
            jcr {
              mutateNode(pathOrId: $path) {
                addMixins(mixins: ["jmix:unstructured"])
              }
            }
          }
        `),
        { path }
      );
      if (mixin.error) throw mixin.error;
    }

    // At this point, the node exists and we are allowed to update it
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
      {
        path,
        properties: prepareProperties(
          isManaged ? rawProperties : { ...rawProperties, [MANAGED_MARKER]: 'true' },
          language
        ),
        publish,
        language,
      }
    );

    if (error) throw error;
  }
};

/** Transforms a POJO (`{name: "value"}`) into the right GraphQL input object. */
const prepareProperties = (props: Record<string, unknown>, language: string) =>
  Object.entries(props).map<ReturnType<typeof graphql.scalar<'InputJCRProperty'>>>(
    ([name, value]) => {
      if (typeof value !== 'string') throw new Error(`Property "${name}" must be a string.`);
      return { name, value, language, type: 'STRING' };
    }
  );
