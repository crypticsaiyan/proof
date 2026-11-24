// A scripted customer for live demos: real mouse and keyboard input in our own Chrome, against the
// shop with the Proof SDK on it. Usage: node spike/live-user.ts [shopUrl]

import { Cdp, launchChrome } from '../packages/recorder/src/index.ts';

const shop = process.argv[2] ?? 'http://localhost:3100';
const chrome = await launchChrome({ headless: process.env.HEADED !== '1', width: 1280, height: 900 });
const cdp = new Cdp(chrome.wsUrl);
await cdp.ready;
const { targetInfos } = await cdp.send('Target.getTargets');
const { targetId } = targetInfos.find((t: { type: string }) => t.type === 'page');
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
const send = (m: string, p: object = {}) => cdp.send(m, p, sessionId);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const js = async (expression: string) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
await send('Page.enable');
await send('Runtime.enable');

async function until(what: string, expr: string) {
  for (let i = 0; i < 100; i++) {
    if (await js(expr).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`timed out: ${what}`);
}
const onPage = (path: string) =>
  until(path, `location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && !!window.Proof`);

async function click(el: string, count = 1) {
  const p = await js(
    `(() => { const e = ${el}; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`,
  );
  for (let i = 0; i < count; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
    await sleep(150);
  }
  await sleep(600);
}
async function type(el: string, text: string) {
  await click(el);
  await js(`${el}.select()`);
  await send('Input.insertText', { text });
  await js(`${el}.blur()`);
  await sleep(250);
}
const $ = (sel: string) => `document.querySelector(${JSON.stringify(sel)})`;

await send('Page.navigate', { url: `${shop}/` });
await onPage('/');
let report =
  'I used my welcome code on the tea tin and now I cannot place my order. It just says something went wrong.';
if (process.env.BUG === 'B') {
  // Discount stacking: nothing crashes, only the shopper (or the shop) can tell.
  report = 'I applied SAVE10 twice on the kettle and it took 10% off twice. The same code should only count once.';
  await click($('[data-testid="add-pour-over-kettle"]'));
  await onPage('/cart');
  for (let i = 0; i < 2; i++) {
    await type($('[data-testid="coupon-input"]'), 'SAVE10');
    await click($('[data-testid="coupon-apply"]'));
    await onPage('/cart');
  }
} else {
  await click($('a[href="/product/stoneware-mug"]'));
  await onPage('/product/stoneware-mug');
  await click($('header a[href="/"]'));
  await onPage('/');
  await click($('[data-testid="add-tea-tin"]'));
  await onPage('/cart');
  await type($('[data-testid="coupon-input"]'), 'WELCOME20');
  await click($('[data-testid="coupon-apply"]'));
  await onPage('/cart');
  await click($('a[href="/checkout"]'));
  await onPage('/checkout');
  await type($('input[name="name"]'), 'Maya Chen');
  await type($('input[name="email"]'), 'maya@example.com');
  await click($('#place-order'));
  await sleep(1500);
  await click($('#place-order'), 3);
  await sleep(3000);
}

// Report it through the widget.
const w = `document.getElementById('proof-widget').shadowRoot`;
await click(`${w}.querySelector('.pill')`);
await click(`${w}.querySelector('textarea')`);
await send('Input.insertText', { text: report });
await click(`${w}.querySelector('input[type=email]')`);
await send('Input.insertText', { text: 'maya@example.com' });
await click(`${w}.querySelector('.send')`);
await sleep(2500);
console.log('session finished on', await js('location.pathname'));
cdp.close();
await chrome.close();
