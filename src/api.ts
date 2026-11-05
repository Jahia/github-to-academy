import type { Client } from '@urql/core';
import { graphql } from 'gql.tada';
import assert from 'node:assert/strict';
import { basename, dirname } from 'node:path/posix';
import { fingerprint } from './publication.ts';

/**
 * Marker property stamped on every node created (or knowingly overwritten) by
 * this action, carried by the jmix:unstructured mixin. Its presence tells
 * subsequent runs the node is managed from GitHub and safe to update; without
 * it, updates are refused unless the document opts in with `overwrite: true`.
 */
export const MANAGED_MARKER = 'githubToAcademyManaged';

/**
 * Property, carried by jmix:unstructured too, that holds the fingerprint of
 * the values last pushed in a language. A push whose fingerprint matches it
 * writes nothing.
 */
export const fingerprintProperty = (language: string) => `githubToAcademyFingerprint_${language}`;

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
    fingerprintOf = rawProperties,
  }: {
    path: string;
    type: string;
    properties: Record<string, unknown>;
    language: string;
    publish: boolean;
    /** Allow updating a node that does not carry the MANAGED_MARKER property. */
    overwrite?: boolean;
    /**
     * The values that identify what is pushed, when they differ from
     * `properties`: a body without the parts that change on every push.
     */
    fingerprintOf?: Record<string, unknown>;
  }
) => {
  const pushed = fingerprint(fingerprintOf);
  const stamps = { [MANAGED_MARKER]: 'true', [fingerprintProperty(language)]: pushed };

  // Fetch the node to see if it exists, if it's of a compatible node type,
  // whether it is marked as managed by this action, and the fingerprint of
  // what was last pushed to it
  const { data, error } = await client.query(
    graphql(`
      query ($path: String!, $marker: String!, $fingerprint: String!, $language: String!) {
        jcr {
          nodeByPath(path: $path) {
            primaryNodeType {
              name
            }
            property(name: $marker, language: $language) {
              value
            }
            fingerprint: property(name: $fingerprint, language: $language) {
              value
            }
          }
        }
      }
    `),
    { path, marker: MANAGED_MARKER, fingerprint: fingerprintProperty(language), language }
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
        properties: prepareProperties({ ...rawProperties, ...stamps }, language),
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

    // A write sets jcr:lastModified, and the node then waits for a
    // publication, even when every value is the one it already holds. Skip
    // the write when the same values were pushed last time, so a re-push of
    // a published document leaves it published.
    const changed = !isManaged || data.jcr.nodeByPath.fingerprint?.value !== pushed;

    if (!changed && !publish) return;

    // At this point, the node exists and we are allowed to update it
    const { error } = await client.mutation(
      graphql(`
        mutation (
          $path: String!
          $properties: [InputJCRProperty!]!
          $write: Boolean!
          $publish: Boolean!
          $language: String!
        ) {
          jcr @include(if: $write) {
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
        properties: prepareProperties({ ...rawProperties, ...stamps }, language),
        write: changed,
        publish,
        language,
      }
    );

    if (error) throw error;
  }
};

/**
 * The publication status of the node at `path` in `language`, a value of the
 * `PublicationStatus` GraphQL enum. Only the node itself counts, not its
 * children: the page of a document holds nodes the action keeps unpublished
 * on purpose, such as the GitHub banner.
 */
export const getPublicationStatus = async (
  client: Client,
  { path, language }: { path: string; language: string }
): Promise<string> => {
  const { data, error } = await client.query(
    graphql(`
      query ($path: String!, $language: String!) {
        jcr {
          nodeByPath(path: $path) {
            aggregatedPublicationInfo(language: $language, subNodes: false, references: false) {
              publicationStatus
            }
          }
        }
      }
    `),
    { path, language }
  );

  if (error) throw error;

  const status = data?.jcr.nodeByPath?.aggregatedPublicationInfo.publicationStatus;
  assert(status, `Node at path "${path}" has no publication status.`);
  return status;
};

/** Transforms a POJO (`{name: "value"}`) into the right GraphQL input object. */
const prepareProperties = (props: Record<string, unknown>, language: string) =>
  Object.entries(props).map<ReturnType<typeof graphql.scalar<'InputJCRProperty'>>>(
    ([name, value]) => {
      if (typeof value !== 'string') throw new Error(`Property "${name}" must be a string.`);
      return { name, value, language, type: 'STRING' };
    }
  );
