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
    mixins = [],
    properties: rawProperties,
    language,
    publish,
  }: {
    path: string;
    type: string;
    mixins?: string[];
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
          $mixins: [String!]!
          $properties: [InputJCRProperty!]!
          $publish: Boolean!
          $language: String!
        ) {
          jcr {
            # addNode applies the mixins before it sets the properties, so a
            # property defined by a mixin can be set in this same call
            addNode(
              parentPathOrId: $parent
              name: $name
              primaryNodeType: $type
              mixins: $mixins
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
        mixins,
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
          $mixins: [String!]!
          $hasMixins: Boolean!
          $properties: [InputJCRProperty!]!
          $publish: Boolean!
          $language: String!
        ) {
          # Root mutation fields run in order, so the mixins are in place before
          # the properties they define are set. Adding a mixin the node already
          # has is a no-op, which keeps a re-push idempotent. Skipped entirely
          # when there are none, so content that sets no mixins neither depends
          # on this field nor pays for an extra write.
          mixins: jcr @include(if: $hasMixins) {
            mutateNode(pathOrId: $path) {
              addMixins(mixins: $mixins)
            }
          }
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
      { path, mixins, hasMixins: mixins.length > 0, properties, publish, language }
    );

    if (error) throw error;
  }
};

/** Deletes the node at `path` when it exists with a primary type other than `type`. */
export const deleteIfTypeDiffers = async (
  client: Client,
  { path, type }: { path: string; type: string }
) => {
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

  // Nothing to delete
  if (error?.graphQLErrors.some(({ message }) => message.includes('PathNotFoundException'))) {
    return;
  }
  if (error) throw error;

  const currentType = data?.jcr.nodeByPath?.primaryNodeType.name;
  if (!currentType || currentType === type) return;

  const result = await client.mutation(
    graphql(`
      mutation ($path: String!) {
        jcr {
          deleteNode(pathOrId: $path)
        }
      }
    `),
    { path }
  );

  if (result.error) throw result.error;
};

/**
 * Ensures the node named `name` under `parent` is its first child node,
 * reordering the children if needed. The node must already exist.
 */
export const ensureFirstChild = async (
  client: Client,
  { parent, name }: { parent: string; name: string }
) => {
  const { data, error } = await client.query(
    graphql(`
      query ($path: String!) {
        jcr {
          nodeByPath(path: $path) {
            children {
              nodes {
                name
              }
            }
          }
        }
      }
    `),
    { path: parent }
  );

  if (error) throw error;

  const names = data?.jcr.nodeByPath?.children?.nodes?.map((node) => node?.name) ?? [];
  assert(names.includes(name), `Node "${name}" not found under "${parent}".`);

  // Already the first child, nothing to do
  if (names[0] === name) return;

  const result = await client.mutation(
    graphql(`
      mutation ($path: String!, $names: [String!]!) {
        jcr {
          mutateNode(pathOrId: $path) {
            reorderChildren(names: $names, position: FIRST)
          }
        }
      }
    `),
    { path: parent, names: [name] }
  );

  if (result.error) throw result.error;
};

/** JCR property types, as the `JCRPropertyType` GraphQL enum spells them. */
const PROPERTY_TYPES = new Set([
  'BOOLEAN',
  'DATE',
  'DECIMAL',
  'LONG',
  'DOUBLE',
  'BINARY',
  'NAME',
  'PATH',
  'REFERENCE',
  'STRING',
  'UNDEFINED',
  'URI',
  'WEAKREFERENCE',
]);

/**
 * A property given as `{type, value}` or `{type, values}` rather than as a bare
 * scalar, for the types that cannot be told apart from a string: a weakreference
 * is only a path or a uuid, and a `NAME` or a `URI` is just text too.
 *
 * ```yaml
 * products:
 *   type: WEAKREFERENCE
 *   values: ['/sites/systemsite/categories/products/jahia']
 * ```
 */
type ExplicitProperty = {
  type: string;
  option?: string;
  value?: unknown;
  values?: unknown[];
};

const isExplicitProperty = (value: unknown): value is ExplicitProperty =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  'type' in value;

/** The JCR type a bare frontmatter scalar maps onto. */
const inferType = (name: string, value: unknown) => {
  if (typeof value === 'string') return 'STRING';
  // YAML 1.2 only reads `true`/`false` as booleans - `yes`, `no`, `on` and `off`
  // stay strings - and both render back to the text that was written
  if (typeof value === 'boolean') return 'BOOLEAN';
  // Only an explicit `!!timestamp` tag yields a Date; the core schema has no
  // implicit timestamp type, so a bare ISO-8601 value arrives here as a string
  if (value instanceof Date && !Number.isNaN(value.getTime())) return 'DATE';

  // A bare number is refused on purpose. YAML has already thrown away the text
  // that was written, so `0123` arrives as 123, `0x1F` as 31, `1.10` as 1.1 and
  // a long id loses precision. Writing any of those back would store a value
  // that differs from the one in the file, which is worse than failing here.
  if (typeof value === 'number')
    throw new Error(
      `Property "${name}" is a bare number, which YAML has already rewritten ` +
        `(it parsed as ${value}). Quote it to keep the text as written, or use ` +
        'the explicit form {type: LONG, value: ...} to store it as a number.'
    );

  throw new Error(
    `Property "${name}" has a value of an unsupported type. Use a string, ` +
      'a boolean, a date, an array of those, or the explicit form ' +
      `{type: ..., value: ...}. Received: ${JSON.stringify(value) ?? typeof value}.`
  );
};

/**
 * Every JCR value travels as a string; `type` tells Jahia how to read it back.
 * Dates go as ISO-8601, which is what the JCR value factory expects.
 */
const toValue = (name: string, value: unknown) => {
  inferType(name, value); // rejects anything we cannot represent
  return value instanceof Date ? value.toISOString() : String(value);
};

/**
 * Same, but for the explicit form, where a number is the author's stated intent
 * rather than something YAML decided on their behalf.
 */
const toExplicitValue = (name: string, value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : toValue(name, value);

/** Transforms a POJO (`{name: "value"}`) into the right GraphQL input object. */
export const prepareProperties = (props: Record<string, unknown>, language: string) =>
  Object.entries(props).map<ReturnType<typeof graphql.scalar<'InputJCRProperty'>>>(
    ([name, value]) => {
      if (isExplicitProperty(value)) {
        const { type, option, value: single, values: multiple } = value;

        if (!PROPERTY_TYPES.has(type))
          throw new Error(
            `Property "${name}" has an unknown type "${type}". ` +
              `Expected one of: ${[...PROPERTY_TYPES].join(', ')}.`
          );
        if ((single === undefined) === (multiple === undefined))
          throw new Error(`Property "${name}" needs exactly one of "value" or "values".`);
        if (multiple !== undefined && !Array.isArray(multiple))
          throw new Error(`Property "${name}" has a "values" that is not an array.`);

        return {
          name,
          language,
          type,
          ...(option == null ? {} : { option }),
          ...(multiple === undefined
            ? { value: toExplicitValue(name, single) }
            : { values: multiple.map((item) => toExplicitValue(name, item)) }),
        };
      }

      if (Array.isArray(value)) {
        // An empty array still means "multivalued", and STRING is the JCR default
        const type = value.length === 0 ? 'STRING' : inferType(name, value[0]);

        return {
          name,
          language,
          type,
          values: value.map((item) => {
            if (inferType(name, item) !== type)
              throw new Error(
                `Property "${name}" mixes value types in the same array. ` +
                  'A multivalued JCR property has one type; use the explicit ' +
                  'form {type: ..., values: [...]} to choose it.'
              );
            return toValue(name, item);
          }),
        };
      }

      return { name, value: toValue(name, value), language, type: inferType(name, value) };
    }
  );
