import type { Client } from '@urql/core';
import { graphql } from 'gql.tada';
import assert from 'node:assert/strict';
import { basename, dirname } from 'node:path/posix';

/** Inserts or updates a node. */
export const upsertNode = async (
  client: Client,
  {
    path,
    type,
    properties: rawProperties,
    language,
    publish,
  }: {
    path: string;
    type: string;
    properties: Record<string, unknown>;
    language: string;
    publish: boolean;
  }
) => {
  const properties = prepareProperties(rawProperties, language);

  // Fetch the node to see if it exists and if it's of a compatible node type
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
    { path }
  );

  if (error?.graphQLErrors.some(({ message }) => message.includes('PathNotFoundException'))) {
    // If the node was not found, we create it
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
        path,
        type,
        properties,
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

    // At this point, the node exists, update it
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
};

/** Transforms a POJO (`{name: "value"}`) into the right GraphQL input object. */
const prepareProperties = (props: Record<string, unknown>, language: string) =>
  Object.entries(props).map<ReturnType<typeof graphql.scalar<'InputJCRProperty'>>>(
    ([name, value]) => {
      if (typeof value !== 'string') throw new Error(`Property "${name}" must be a string.`);
      return { name, value, language, type: 'STRING' };
    }
  );
