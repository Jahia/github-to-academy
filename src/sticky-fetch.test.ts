import assert from 'node:assert/strict';
import test from 'node:test';
import { createStickyFetch } from './sticky-fetch.ts';

test('sticky fetch replays load balancer cookies', async () => {
  const seenCookieHeaders: Array<string | null> = [];

  const fakeFetch: typeof fetch = async (_input, init) => {
    seenCookieHeaders.push(new Headers(init?.headers).get('cookie'));

    const headers = new Headers();
    headers.append('set-cookie', 'SERVERID=s11481; path=/; HttpOnly; Secure');
    headers.append('set-cookie', 'slb_route=abc123; Path=/; Secure; HttpOnly');
    return new Response('{}', { headers });
  };

  const stickyFetch = createStickyFetch(fakeFetch);

  // First request carries no cookie, we don't have any yet
  await stickyFetch('https://academy.example.com/modules/graphql');
  assert.equal(seenCookieHeaders[0], null);

  // Subsequent requests replay the cookies received, on top of existing headers
  await stickyFetch('https://academy.example.com/modules/graphql', {
    headers: { authorization: 'Basic xyz' },
  });
  assert.equal(seenCookieHeaders[1], 'SERVERID=s11481; slb_route=abc123');
});
