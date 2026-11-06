import assert from 'node:assert/strict';
import test from 'node:test';
import { isAcademyFrontmatter } from './frontmatter.ts';

test('a frontmatter with a content or a page block is pushed', () => {
  assert.equal(isAcademyFrontmatter({ content: { $path: '/sites/academy/home/a' } }), true);
  assert.equal(isAcademyFrontmatter({ page: { $path: '/sites/academy/home/a' }, content: { $subpath: 'area/text' } }), true);
  // a malformed block is still meant for the Academy: the schema refuses it and the job fails
  assert.equal(isAcademyFrontmatter({ page: 'oops' }), true);
});

test('no frontmatter, or one meant for another tool, is left alone', () => {
  assert.equal(isAcademyFrontmatter(undefined), false);
  assert.equal(isAcademyFrontmatter({}), false);
  assert.equal(isAcademyFrontmatter({ status: 'accepted', date: '2026-11-04', 'decision-makers': 'the maintainers' }), false);
  assert.equal(isAcademyFrontmatter({ language: 'fr', publish: false }), false);
});
