import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { deliver } from '../src/ship.ts';

test('reply counts as delivered only when the webhook accepts it', async () => {
  const note = { to: 'maya@example.com', name: 'Maya', subject: 's', body: 'b', video: '/home/x/run.mp4' };
  delete process.env.PROOF_NOTIFY_WEBHOOK;
  assert.equal(await deliver(note), false);
  let status = 200;
  let got = '';
  const srv = createServer((req, res) => {
    req.on('data', (c) => {
      got += c;
    });
    req.on('end', () => res.writeHead(status).end());
  });
  await new Promise<void>((r) => srv.listen(0, r));
  process.env.PROOF_NOTIFY_WEBHOOK = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
  assert.equal(await deliver(note), true);
  assert.deepEqual(JSON.parse(got), { to: 'maya@example.com', name: 'Maya', subject: 's', body: 'b' });
  status = 500;
  assert.equal(await deliver(note), false);
  srv.close();
  srv.closeAllConnections();
});
