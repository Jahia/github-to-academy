import assert from 'node:assert/strict';
import test from 'node:test';

import { print } from 'graphql';
import { VFile } from 'vfile';
import { matter } from 'vfile-matter';

import { prepareProperties, upsertNode } from './api.ts';

/** Parses a frontmatter value the way the action really does, via vfile-matter. */
const fromFrontmatter = (yaml: string) => {
  const file = new VFile({ value: `---\nv: ${yaml}\n---\n` });
  matter(file);
  return (file.data.matter as { v: unknown }).v;
};

const one = (value: unknown) => prepareProperties({ p: value }, 'en')[0];

test('strings stay STRING, single valued, in the given language', () => {
  assert.deepEqual(one('hello'), { name: 'p', value: 'hello', language: 'en', type: 'STRING' });
});

test('booleans become BOOLEAN', () => {
  assert.deepEqual(one(true), { name: 'p', value: 'true', language: 'en', type: 'BOOLEAN' });
  assert.deepEqual(one(false), { name: 'p', value: 'false', language: 'en', type: 'BOOLEAN' });
});

test('bare numbers are refused rather than silently re-rendered', () => {
  // YAML has already discarded the text the author wrote: `0123` arrives as 123,
  // `0x1F` as 31, `1.10` as 1.1. Writing any of those back into a STRING property
  // would store a different value than the one in the file, so refuse and say how
  // to be explicit.
  for (const yaml of ['42', '0123', '0x1F', '1.10', '12345678901234567890']) {
    const value = fromFrontmatter(yaml);
    assert.equal(typeof value, 'number');
    assert.throws(() => one(value), /Property "p"/);
    assert.throws(() => one(value), /quote it|explicit form/);
  }
});

test('dates become DATE', () => {
  const prop = one(new Date('2026-10-01T00:00:00.000Z'));
  assert.equal(prop.type, 'DATE');
  assert.equal(prop.value, '2026-10-01T00:00:00.000Z');
});

test('an unquoted timestamp is a string to YAML 1.2, not a date', () => {
  // The core schema has no implicit timestamp type, so this is NOT a Date and is
  // sent as STRING. Only an explicit !!timestamp tag produces one.
  assert.equal(typeof fromFrontmatter('2026-10-01T00:00:00.000Z'), 'string');
  assert.ok(fromFrontmatter('!!timestamp 2026-10-01') instanceof Date);
  assert.equal(one(fromFrontmatter('!!timestamp 2026-10-01')).type, 'DATE');
});

test('arrays become multivalued, with no `value`', () => {
  const prop = one(['a', 'b']);
  assert.deepEqual(prop, { name: 'p', values: ['a', 'b'], language: 'en', type: 'STRING' });
  assert.ok(!('value' in prop), '`value` and `values` are mutually exclusive');
});

test('an empty array is still multivalued', () => {
  assert.deepEqual(one([]), { name: 'p', values: [], language: 'en', type: 'STRING' });
});

test('arrays take their type from their elements', () => {
  assert.equal(one([true, false]).type, 'BOOLEAN');
});

test('the explicit form carries a type that cannot be inferred', () => {
  // A weakreference is just a path or a uuid, indistinguishable from a string
  const prop = one({
    type: 'WEAKREFERENCE',
    values: ['/sites/systemsite/categories/products/jahia'],
  });
  assert.deepEqual(prop, {
    name: 'p',
    values: ['/sites/systemsite/categories/products/jahia'],
    language: 'en',
    type: 'WEAKREFERENCE',
  });
});

test('the explicit form accepts a single value and an option', () => {
  const prop = one({ type: 'STRING', option: 'ENCRYPTED', value: 'hunter2' });
  assert.deepEqual(prop, {
    name: 'p',
    value: 'hunter2',
    language: 'en',
    type: 'STRING',
    option: 'ENCRYPTED',
  });
});

test('the explicit form coerces non-string values', () => {
  assert.deepEqual(one({ type: 'DATE', value: new Date('2026-10-01T00:00:00.000Z') }), {
    name: 'p',
    value: '2026-10-01T00:00:00.000Z',
    language: 'en',
    type: 'DATE',
  });
});

test('rejects values it cannot represent, naming the property', () => {
  assert.throws(() => one(null), /Property "p"/);
  assert.throws(() => one({ nested: 'object' }), /Property "p"/);
  assert.throws(() => one([{ a: 1 }]), /Property "p"/);
  assert.throws(() => one({ type: 'STRING' }), /Property "p"/); // neither value nor values
  assert.throws(() => one({ type: 'STRING', value: 'a', values: ['b'] }), /Property "p"/);
  assert.throws(() => one({ type: 'NOPE', value: 'a' }), /Property "p"/);
});

test('mixed-type arrays are rejected rather than silently coerced', () => {
  assert.throws(() => one(['a', 1]), /Property "p"/);
});


// --- upsertNode -------------------------------------------------------------

const PATH = '/sites/academy/contents/kb/entry';

/** Minimal urql stand-in that records the mutations it is handed. */
const fakeClient = (queryResult: unknown) => {
  const mutations: { document: string; variables: Record<string, unknown> }[] = [];
  const client = {
    query: async () => queryResult,
    mutation: async (document: unknown, variables: Record<string, unknown>) => {
      mutations.push({ document: print(document as never), variables });
      return { error: undefined };
    },
  };
  return { client: client as never, mutations };
};

const NOT_FOUND = { error: { graphQLErrors: [{ message: 'PathNotFoundException: nope' }] } };
const FOUND = { data: { jcr: { nodeByPath: { primaryNodeType: { name: 'jacademy:kbEntry' } } } } };

test('creating a node passes the mixins to addNode', async () => {
  const { client, mutations } = fakeClient(NOT_FOUND);

  await upsertNode(client, {
    path: PATH,
    type: 'jacademy:kbEntry',
    mixins: ['jacademix:kbQa'],
    properties: { 'jcr:title': 'Title' },
    language: 'en',
    publish: false,
  });

  assert.equal(mutations.length, 1);
  assert.match(mutations[0].document, /addNode\([^)]*mixins: \$mixins/s);
  assert.deepEqual(mutations[0].variables.mixins, ['jacademix:kbQa']);
});

test('updating a node adds the mixins before setting the properties', async () => {
  const { client, mutations } = fakeClient(FOUND);

  await upsertNode(client, {
    path: PATH,
    type: 'jacademy:kbEntry',
    mixins: ['jacademix:kbQa', 'jacademix:metadatas'],
    properties: { 'jcr:title': 'Title' },
    language: 'en',
    publish: false,
  });

  const { document, variables } = mutations[0];
  assert.deepEqual(variables.mixins, ['jacademix:kbQa', 'jacademix:metadatas']);
  assert.equal(variables.hasMixins, true);
  // A mixin has to exist before a property it defines can be set, and only
  // root-level mutation fields are guaranteed to run in order
  assert.ok(
    document.indexOf('addMixins') < document.indexOf('setPropertiesBatch'),
    'addMixins must come before setPropertiesBatch'
  );
});

test('updating a node without mixins does not call addMixins', async () => {
  const { client, mutations } = fakeClient(FOUND);

  await upsertNode(client, {
    path: PATH,
    type: 'jacademy:kbEntry',
    properties: { 'jcr:title': 'Title' },
    language: 'en',
    publish: false,
  });

  // Existing users set no mixins; they must not start depending on addMixins
  assert.equal(mutations[0].variables.hasMixins, false);
  assert.deepEqual(mutations[0].variables.mixins, []);
});
