// Full-page screenshots of the dashboard at several widths, light and dark, for design review.
// Usage: node apps/server/src/shots.ts [baseUrl] [outDir]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Cdp, launchChrome } from '../../../packages/recorder/src/index.ts';

const base = process.argv[2] ?? 'http://localhost:4600';
const out = resolve(process.argv[3] ?? 'out/shots');
const widths = (process.env.SHOT_WIDTHS ?? '1440,768,390').split(',').map(Number);
const schemes = (process.env.SHOT_SCHEMES ?? 'light,dark').split(',');

// SHOT_URLS=comma-separated absolute URLs shoots other sites (design research) instead of Proof.
const external = process.env.SHOT_URLS?.split(',').filter(Boolean);
const paths = external?.length
  ? external
  : [
      '/',
      ...(await (
        await fetch(`${base}/api/incidents`)
      )
        .json()
        .then((xs: { id: string }[]) => xs.flatMap((x) => [`/incidents/${x.id}`, `/r/${x.id}`]))),
    ];
const maxH = Number(process.env.SHOT_MAX_HEIGHT ?? 0);

mkdirSync(out, { recursive: true });
const chrome = await launchChrome({ headless: true, width: 1440, height: 900 });
const cdp = new Cdp(chrome.wsUrl);
await cdp.ready;
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, s);

for (const p of paths) {
  for (const w of widths) {
    for (const scheme of schemes) {
      await cdp.send(
        'Emulation.setDeviceMetricsOverride',
        { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 },
        s,
      );
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, s);
      const loaded = new Promise<void>((res) => cdp.on('Page.loadEventFired', () => res()));
      await cdp.send('Page.navigate', { url: p.startsWith('http') ? p : base + p }, s);
      await Promise.race([loaded, new Promise((r) => setTimeout(r, 20_000))]);
      if (external) {
        // Scroll through once so lazy content and scroll-triggered reveals render.
        await cdp.send(
          'Runtime.evaluate',
          {
            expression: `(async () => { for (let y = 0; y < Math.min(document.body.scrollHeight, ${maxH || 6000}); y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 250)); } scrollTo(0, 0); await new Promise(r => setTimeout(r, 800)); })()`,
            awaitPromise: true,
          },
          s,
        );
      }
      await cdp.send(
        'Runtime.evaluate',
        { expression: 'document.fonts.ready.then(() => new Promise(r => setTimeout(r, 900)))', awaitPromise: true },
        s,
      );
      const { result } = await cdp.send(
        'Runtime.evaluate',
        { expression: 'document.documentElement.scrollWidth', returnByValue: true },
        s,
      );
      const overflow = result.value > w ? ` OVERFLOW ${result.value}px` : '';
      const { result: h } = await cdp.send(
        'Runtime.evaluate',
        { expression: 'document.documentElement.scrollHeight', returnByValue: true },
        s,
      );
      const height = maxH ? Math.min(h.value, maxH) : h.value;
      const { data } = await cdp.send(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height, scale: 1 } },
        s,
      );
      const slug = p.startsWith('http')
        ? `${new URL(p).hostname.replace(/^www\./, '')}${new URL(p).pathname.replace(/\/$/, '')}`
        : p === '/'
          ? 'home'
          : p.slice(1);
      const name = `${slug.replaceAll('/', '_')}-${w}-${scheme}.png`;
      writeFileSync(join(out, name), Buffer.from(data, 'base64'));
      console.log(`${name}${overflow}`);
    }
  }
}
cdp.close();
await chrome.close();
