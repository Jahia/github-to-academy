import assert from 'node:assert/strict';
import test from 'node:test';
import { invalidLinkHints } from './hints.ts';

const jahiaError = (link: string) =>
  new Error(
    '[GraphQL] /sites/academy/home/documentation/jahia/8_2/sysadmin/some-page/document-area/content ' +
      `Text: Invalid link${link}`
  );

test('a link without an extension gets the ".html" hint', () => {
  const link = '/sites/academy/home/documentation/jahia-cloud/latest/environment/upgrade-your-environment';
  assert.deepEqual(invalidLinkHints(jahiaError(link)), [
    `Jahia refused the link "${link}". A link to an Academy page must end with ".html": ` +
      `write "${link}.html".`,
  ]);
});

test('a link that already ends with ".html" points at a missing target', () => {
  const [hint] = invalidLinkHints(jahiaError('/sites/academy/home/missing.html'));
  assert.match(hint, /nothing exists at this path/);
});

test('a dot in a parent folder does not count as an extension', () => {
  const [hint] = invalidLinkHints(jahiaError('/sites/academy/home/8.2/page'));
  assert.match(hint, /must end with "\.html": write "\/sites\/academy\/home\/8\.2\/page\.html"/);
});

test('the same link reported twice gives one hint', () => {
  const error = new Error(`${jahiaError('/a/b').message}\n${jahiaError('/a/b').message}`);
  assert.equal(invalidLinkHints(error).length, 1);
});

test('an unrelated error gives no hint', () => {
  assert.deepEqual(invalidLinkHints(new Error('PathNotFoundException: /a/b')), []);
  assert.deepEqual(invalidLinkHints('not an error'), []);
});
