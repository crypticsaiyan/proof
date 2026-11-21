import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { Breadcrumb, Incident } from '../../engine/src/types.ts';
import { Cdp, launchChrome } from '../../recorder/src/index.ts';
import { buildSdk } from '../build.ts';

type Ingest = { incident: Omit<Incident, 'id' | 'createdAt'>; sessionId: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const page = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>${title}</title>
<script src="/sdk.js" data-project="test-shop" defer></script></head>
<body>${body}</body></html>`;

const HOME = page(
  'Shop',
  `<h1>Shop</h1>
<div class="card">
  <h3>Blue Speckled Mug</h3>
  <form method="post" action="/cart">
    <label for="qty">Quantity</label> <input id="qty" name="qty" type="number" value="1">
    <label>Gift card PIN <input id="pin" name="pin" type="password"></label>
    <button type="submit" id="add">Add to cart</button>
  </form>
</div>`,
);

const CHECKOUT = page(
  'Checkout',
  `<h1>Checkout</h1>
<section>
  <h2>Payment</h2>
  <button type="button" id="coupon">Apply code</button>
  <button type="button" id="pay">Place order</button>
</section>
<script>
document.getElementById('pay').addEventListener('click', async () => {
  const res = await fetch('/api/checkout', { method: 'POST', body: '{}' });
  if (!res.ok) console.error('[checkout] payment failed: Internal error');
});
</script>`,
);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
    });
    req.on('end', () => res(s));
  });
}

test('sdk captures a multi-page session, auto incident, widget report and replay', { timeout: 45_000 }, async () => {
  const { file } = await buildSdk();
  const bundle = readFileSync(file);

  const ingest: Ingest[] = [];
  const eventPosts: { sessionId: string; events: { type: number; data?: any }[] }[] = [];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const body = req.method === 'POST' ? await readBody(req) : '';
    res.setHeader('access-control-allow-origin', '*');
    const send = (status: number, type: string, data: string | Buffer, extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': type, ...extra });
      res.end(data);
    };
    const m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
    if (url.pathname === '/sdk.js') return send(200, 'text/javascript', bundle);
    if (url.pathname === '/') return send(200, 'text/html', HOME);
    if (url.pathname === '/checkout') return send(200, 'text/html', CHECKOUT);
    if (url.pathname === '/cart' && req.method === 'POST')
      return send(303, 'text/plain', '', { location: '/checkout' });
    if (url.pathname === '/api/checkout') return send(500, 'application/json', '{"error":"Internal error"}');
    if (url.pathname === '/api/ingest' && req.method === 'POST') {
      ingest.push(JSON.parse(body));
      return send(200, 'application/json', `{"id":"inc-${ingest.length}"}`);
    }
    if (m && req.method === 'POST') {
      eventPosts.push({ sessionId: decodeURIComponent(m[1]), events: JSON.parse(body).events });
      return send(200, 'application/json', '{"ok":true}');
    }
    send(404, 'text/plain', 'not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const chrome = await launchChrome();
  const cdp = new Cdp(chrome.wsUrl);
  try {
    await cdp.ready;
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find((t: { type: string }) => t.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const send = (method: string, params: object = {}) => cdp.send(method, params, sessionId);
    await send('Page.enable');
    await send('Runtime.enable');

    const evaluate = async (expression: string): Promise<any> => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const waitFor = async (what: string, fn: () => boolean | Promise<boolean>, ms = 10_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await Promise.resolve(fn()).catch(() => false)) return;
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    const waitForPage = (path: string) =>
      waitFor(`page ${path}`, () =>
        evaluate(
          `location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && !!window.Proof`,
        ),
      );
    const type = async (selector: string, text: string) => {
      await evaluate(`(() => { const el = ${selector}; el.value = ''; el.focus(); })()`);
      await send('Input.insertText', { text });
      await evaluate(`${selector}.blur()`);
    };

    // Page 1: fill the form (real typing), submit with a click: full page POST + redirect.
    await send('Page.navigate', { url: `${base}/` });
    await waitForPage('/');
    await type(`document.getElementById('qty')`, '3');
    await type(`document.getElementById('pin')`, '4242');
    await evaluate(`document.getElementById('add').click()`);

    // Page 2: rage-click a dead button, then trigger the 500 + console.error.
    await waitForPage('/checkout');
    await evaluate(`(() => { const b = document.getElementById('coupon'); b.click(); b.click(); b.click(); })()`);
    await evaluate(`document.getElementById('pay').click()`);
    await waitFor('auto incident', () => ingest.some((i) => i.incident.source === 'sdk'));

    const auto = ingest.find((i) => i.incident.source === 'sdk') as Ingest;
    const inc = auto.incident;
    assert.equal(inc.project, 'test-shop');
    assert.equal(inc.origin, base);
    assert.equal(inc.replay, auto.sessionId);
    assert.ok(inc.viewport && inc.viewport.w > 0 && inc.userAgent);

    const crumbs = inc.breadcrumbs;
    const at = (pred: (b: Breadcrumb) => boolean, what: string) => {
      const i = crumbs.findIndex(pred);
      assert.ok(i >= 0, `missing breadcrumb: ${what}\n${JSON.stringify(crumbs, null, 1)}`);
      return i;
    };
    const nav1 = at((b) => b.kind === 'nav' && b.url === `${base}/`, 'nav /');
    const qty = at((b) => b.kind === 'input' && b.label === 'Quantity' && b.value === '3', 'qty input');
    const pin = at((b) => b.kind === 'input' && b.label === 'Gift card PIN' && b.value === '***', 'masked pin');
    const add = at(
      (b) => b.kind === 'click' && b.text === 'Add to cart' && b.context === 'Blue Speckled Mug' && !!b.selector,
      'add click with context',
    );
    const nav2 = at((b) => b.kind === 'nav' && b.url === `${base}/checkout`, 'nav /checkout');
    at((b) => b.kind === 'rage' && b.text === 'Apply code', 'rage');
    const pay = at((b) => b.kind === 'click' && b.text === 'Place order' && b.context === 'Payment', 'pay click');
    assert.ok(nav1 < qty && qty < pin && pin < add && add < nav2 && nav2 < pay, 'breadcrumbs out of order');
    assert.equal(crumbs.filter((b) => b.kind === 'click' && b.text === 'Apply code').length, 3);

    assert.ok(
      inc.failedRequests.some((r) => r.method === 'POST' && r.url === `${base}/api/checkout` && r.status === 500),
      JSON.stringify(inc.failedRequests),
    );
    assert.ok(inc.consoleErrors.some((e) => e.text.includes('[checkout] payment failed: Internal error')));
    assert.ok(!inc.failedRequests.some((r) => r.url.includes('/api/ingest') || r.url.includes('/api/sessions/')));

    // Same failure again: deduped per session.
    await evaluate(`document.getElementById('pay').click()`);
    await sleep(2000);
    assert.equal(ingest.filter((i) => i.incident.source === 'sdk').length, 1, 'auto incident not deduped');

    // Widget: open, type a report, send.
    const w = `document.getElementById('proof-widget').shadowRoot`;
    await evaluate(`${w}.querySelector('.pill').click()`);
    await evaluate(`${w}.querySelector('textarea').focus()`);
    await send('Input.insertText', { text: 'Place order says something went wrong' });
    await evaluate(`${w}.querySelector('input[type=email]').focus()`);
    await send('Input.insertText', { text: 'ada@example.com' });
    await evaluate(`${w}.querySelector('.send').click()`);
    await waitFor('widget incident', () => ingest.some((i) => i.incident.source === 'widget'));
    await waitFor('thanks message', () => evaluate(`!${w}.querySelector('.thanks').hidden`));
    const widget = (ingest.find((i) => i.incident.source === 'widget') as Ingest).incident;
    assert.equal(widget.report, 'Place order says something went wrong');
    assert.equal(widget.reporter?.email, 'ada@example.com');
    assert.equal(widget.replay, auto.sessionId);
    assert.ok(
      !widget.breadcrumbs.some((b) => /Report a bug|Send|ada@example/.test(`${b.text} ${b.value} ${b.label}`)),
      'widget interactions leaked into breadcrumbs',
    );

    // Replay: both pages' snapshots reached the server under the same session.
    await evaluate('window.Proof.flush()');
    await waitFor('rrweb events', () => {
      const metas = eventPosts.flatMap((p) => p.events).filter((e) => e.type === 4);
      return metas.some((e) => e.data.href === `${base}/`) && metas.some((e) => e.data.href === `${base}/checkout`);
    });
    assert.ok(eventPosts.every((p) => p.sessionId === auto.sessionId));
    const snapshots = eventPosts.flatMap((p) => p.events).filter((e) => e.type === 2);
    assert.ok(snapshots.length >= 2, `expected a full snapshot per page, got ${snapshots.length}`);
  } finally {
    cdp.close();
    await chrome.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
