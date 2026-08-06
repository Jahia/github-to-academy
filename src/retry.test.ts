import assert from 'node:assert/strict';
import test from 'node:test';
import { isPathNotFound, retry } from './retry.ts';

test('retry retries until success', async () => {
  let calls = 0;
  const result = await retry(
    async () => {
      calls++;
      if (calls < 3) throw new Error('javax.jcr.PathNotFoundException: /some/path');
      return 'ok';
    },
    { attempts: 5, delayMs: 1, shouldRetry: isPathNotFound }
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('retry gives up after the configured attempts', async () => {
  let calls = 0;
  await assert.rejects(
    retry(
      async () => {
        calls++;
        throw new Error('javax.jcr.PathNotFoundException: /some/path');
      },
      { attempts: 3, delayMs: 1, shouldRetry: isPathNotFound }
    ),
    /PathNotFoundException/
  );
  assert.equal(calls, 3);
});

test('retry does not retry non-retryable errors', async () => {
  let calls = 0;
  await assert.rejects(
    retry(
      async () => {
        calls++;
        throw new Error('some other failure');
      },
      { attempts: 5, delayMs: 1, shouldRetry: isPathNotFound }
    ),
    /some other failure/
  );
  assert.equal(calls, 1);
});
