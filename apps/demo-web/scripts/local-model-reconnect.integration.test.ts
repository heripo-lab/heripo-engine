import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { reconnectingFetch } from '../src/lib/processing/local-model-reconnect';

test('sends local model requests through the configured dispatcher', async () => {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    response.end(`${request.method}:${body}`);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const response = await reconnectingFetch(url);
    assert.equal(await response.text(), 'GET:');

    const request = new Request(url, { method: 'POST', body: 'hello' });
    const postResponse = await reconnectingFetch(request);
    assert.equal(await postResponse.text(), 'POST:hello');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
