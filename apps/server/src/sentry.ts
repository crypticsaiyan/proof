// Sentry -> Incident. Accepts the alert-rule / issue webhook shapes that embed the event
// (`data.event`, `data.error` or `event`) and maps its breadcrumbs onto Proof's.
// PostHog webhooks carry no session steps, so there is nothing to reproduce from: not supported.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Breadcrumb, Incident } from '@proof/engine';

type Raw = Omit<Incident, 'id' | 'createdAt'> & { createdAt?: string };
const ms = (t: unknown) => (typeof t === 'number' ? t * 1000 : t ? Date.parse(String(t)) : 0) || 0;

/** `button.add[aria-label="Add to cart"]` -> "Add to cart"; a bare selector is kept as is. */
const label = (sel: string) => sel.match(/\[(?:aria-label|title|alt|name|placeholder)="([^"]+)"\]/)?.[1] ?? sel;

export function fromSentry(body: any): Raw | null {
  const ev = body?.data?.event ?? body?.data?.error ?? body?.event;
  if (!ev) return null;
  const pageUrl: string | undefined = ev.request?.url ?? ev.tags?.find?.((t: [string, string]) => t[0] === 'url')?.[1];
  let origin: string;
  try {
    origin = new URL(pageUrl ?? '').origin;
  } catch {
    return null;
  }
  const breadcrumbs: Breadcrumb[] = [];
  const failedRequests: Incident['failedRequests'] = [];
  const consoleErrors: Incident['consoleErrors'] = [];
  for (const b of ev.breadcrumbs?.values ?? (Array.isArray(ev.breadcrumbs) ? ev.breadcrumbs : [])) {
    const t = ms(b.timestamp);
    if (b.category === 'navigation') breadcrumbs.push({ t, kind: 'nav', url: new URL(b.data?.to ?? '/', origin).href });
    else if (b.category === 'ui.click' && b.message)
      breadcrumbs.push({ t, kind: 'click', text: label(b.message), selector: b.message });
    else if ((b.category === 'fetch' || b.category === 'xhr') && Number(b.data?.status_code) >= 400)
      failedRequests.push({
        t,
        method: String(b.data.method ?? 'GET').toUpperCase(),
        url: new URL(b.data.url, origin).href,
        status: Number(b.data.status_code),
      });
    else if (b.category === 'console' && b.level === 'error') consoleErrors.push({ t, text: String(b.message ?? '') });
  }
  if (!consoleErrors.length) {
    const x = ev.exception?.values?.at?.(-1);
    if (x?.value) consoleErrors.push({ text: `${x.type ?? 'Error'}: ${x.value}` });
  }
  return {
    source: 'sentry',
    project: String(ev.project_slug ?? body?.data?.project_slug ?? ev.project ?? 'sentry'),
    origin,
    title: ev.title ? String(ev.title).slice(0, 90) : undefined,
    breadcrumbs,
    failedRequests,
    consoleErrors,
  };
}

export function validSignature(raw: string, header: string | undefined, secret: string): boolean {
  const want = Buffer.from(createHmac('sha256', secret).update(raw, 'utf8').digest('hex'));
  const got = Buffer.from(header ?? '');
  return want.length === got.length && timingSafeEqual(want, got);
}
