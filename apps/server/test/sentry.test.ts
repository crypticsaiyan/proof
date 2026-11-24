import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { fromSentry, validSignature } from '../src/sentry.ts';

test('maps a Sentry event onto an incident', () => {
  const inc = fromSentry({
    data: {
      event: {
        project: 7,
        title: 'Error: checkout failed',
        request: { url: 'https://shop.example/checkout' },
        exception: { values: [{ type: 'Error', value: 'checkout failed' }] },
        breadcrumbs: {
          values: [
            { category: 'navigation', timestamp: 1, data: { from: '/', to: '/cart' } },
            { category: 'ui.click', timestamp: 2, message: 'button.x[aria-label="Place order"]' },
            { category: 'fetch', timestamp: 3, data: { method: 'post', url: '/api/checkout', status_code: 500 } },
            { category: 'fetch', timestamp: 4, data: { method: 'get', url: '/ok', status_code: 200 } },
          ],
        },
      },
    },
  });
  assert.equal(inc?.origin, 'https://shop.example');
  assert.deepEqual(
    inc?.breadcrumbs.map((b) => b.kind),
    ['nav', 'click'],
  );
  assert.equal(inc?.breadcrumbs[1].text, 'Place order');
  assert.deepEqual(inc?.failedRequests, [
    { t: 3000, method: 'POST', url: 'https://shop.example/api/checkout', status: 500 },
  ]);
  assert.equal(inc?.consoleErrors[0].text, 'Error: checkout failed');
});

test('events without a page URL or event body are refused', () => {
  assert.equal(fromSentry({}), null);
  assert.equal(fromSentry({ data: { event: { title: 'x' } } }), null);
});

test('signature check', () => {
  const sig = createHmac('sha256', 's').update('{}').digest('hex');
  assert.equal(validSignature('{}', sig, 's'), true);
  assert.equal(validSignature('{}', 'nope', 's'), false);
  assert.equal(validSignature('{}', undefined, 's'), false);
});
