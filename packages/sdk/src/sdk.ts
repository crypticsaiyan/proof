// @proof/sdk: the Capture stage. Drop-in script tag that records what the user did (breadcrumbs),
// what broke (console errors, failed requests) and an rrweb replay, then ships incidents to Proof.
//
// <script src="https://host/sdk.js" data-project="kiln-and-kettle" data-endpoint="https://host" defer></script>
//
// State lives in sessionStorage so a server-rendered app with full page loads keeps one session.

import { record } from 'rrweb';
import type { Breadcrumb, FailedRequest, Incident } from '../../engine/src/types.ts';

type ConsoleError = Incident['consoleErrors'][number];
type IncidentInput = Omit<Incident, 'id' | 'createdAt'>;
type Crumb = Omit<Breadcrumb, 't'>;
type State = {
  id: string;
  seen: number;
  crumbs: Breadcrumb[];
  errors: ConsoleError[];
  failed: FailedRequest[];
  /** Signatures already reported automatically in this session. */
  sent: string[];
};
type ProofApi = {
  report: (text: string, email?: string) => Promise<boolean>;
  flush: () => Promise<void>;
  sessionId: string;
};

declare global {
  interface Window {
    Proof?: ProofApi;
  }
}

const KEY = 'proof:session';
const EVENTS_KEY = 'proof:events';
const MAX_CRUMBS = 60;
const MAX_ERRORS = 30;
const IDLE_MS = 30 * 60_000;
const AUTO_DELAY_MS = 1500;
const SHIP_EVERY_MS = 5000;
const BEACON_MAX = 60_000;

const INTERACTIVE =
  'button, a, [role=button], [role=link], [role=menuitem], [role=tab], input[type=submit], input[type=button], input[type=reset], summary';
const CONTAINERS =
  '[data-proof-context], .card, .panel, article, li, tr, form, section, fieldset, dialog, [role=dialog]';
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role=heading], [data-proof-heading], legend, caption, .name, .title';

// Keep untouched references: our own traffic must never be seen by the wrappers.
const origFetch = window.fetch.bind(window);

// ---------- helpers ----------

const clean = (s: string | null | undefined, max = 60): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function compact<T extends object>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') (out as any)[k] = v;
  return out;
}

function newId(): string {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return Date.now().toString(36) + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function absUrl(u: string | URL): string {
  try {
    return new URL(String(u), location.href).href.split('#')[0];
  } catch {
    return String(u);
  }
}

function pathOf(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u.split('?')[0];
  }
}

/** Rendered text (skips hidden nodes), which is what a person, and the test agent, actually sees. */
function rendered(el: Element): string {
  // biome-ignore lint/performance/useDomNodeTextContent: we want visible text, not hidden template text
  return (el as HTMLElement).innerText ?? el.textContent ?? '';
}

function visibleText(el: Element, max = 60): string {
  return clean(rendered(el), max);
}

/** Human name of a clickable element: visible text, aria-label, value, title, image alt. */
function nameOf(el: Element): string {
  return (
    visibleText(el) ||
    clean(el.getAttribute('aria-label')) ||
    (el instanceof HTMLInputElement ? clean(el.value) : '') ||
    clean(el.getAttribute('title')) ||
    clean(el.querySelector('img[alt]')?.getAttribute('alt'))
  );
}

/** Short css path: stops at an id or data-testid, otherwise up to 4 levels. */
function selectorOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let i = 0; cur && i < 4; i++) {
    const id = cur.getAttribute('id'); // not cur.id: a form with <input name="id"> clobbers it
    if (id) {
      parts.unshift(`#${CSS.escape(id)}`);
      break;
    }
    const tid = cur.getAttribute('data-testid');
    if (tid) {
      parts.unshift(`[data-testid="${tid.replace(/"/g, '\\"')}"]`);
      break;
    }
    let p = cur.tagName.toLowerCase();
    const cls = Array.from(cur.classList).find((c) => /^[a-zA-Z_-][\w-]*$/.test(c));
    if (cls) p += `.${cls}`;
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur?.tagName);
      if (same.length > 1) p += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(p);
    if (!parent || parent === document.body) break;
    cur = parent;
  }
  return parts.join(' > ');
}

/** Nearest heading inside the closest container, e.g. the product name on a product card. */
function contextOf(el: Element, own: string): string | undefined {
  let box = el.parentElement?.closest(CONTAINERS) ?? null;
  for (let depth = 0; box && depth < 5; depth++) {
    const explicit = clean(box.getAttribute('data-proof-context'), 80);
    if (explicit && explicit !== own) return explicit;
    const candidates = Array.from(box.querySelectorAll(HEADINGS));
    if (box.tagName === 'TR' || box.tagName === 'LI')
      candidates.push(...Array.from(box.querySelectorAll('th, td, a, strong, b')));
    for (const h of candidates) {
      if (h === el || h.contains(el) || el.contains(h)) continue;
      const t = visibleText(h, 80);
      if (t && t !== own) return t;
    }
    box = box.parentElement?.closest(CONTAINERS) ?? null;
  }
  return undefined;
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function labelOf(el: Field): string {
  const lab = el.labels?.[0];
  if (lab) {
    const copy = lab.cloneNode(true) as HTMLElement;
    for (const n of Array.from(copy.querySelectorAll('input, select, textarea, button'))) n.remove();
    const t = clean(copy.textContent, 80);
    if (t) return t;
  }
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = clean(
      by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
      80,
    );
    if (t) return t;
  }
  return clean(el.getAttribute('aria-label'), 80) || clean(el.getAttribute('placeholder'), 80) || clean(el.name, 80);
}

function masked(el: Field): boolean {
  return (
    (el instanceof HTMLInputElement && el.type === 'password') ||
    (el.getAttribute('autocomplete') ?? '').includes('cc-') ||
    !!el.closest('[data-proof-mask]')
  );
}

function fieldValue(el: Field): string {
  if (masked(el)) return '***';
  if (el instanceof HTMLSelectElement) return clean(Array.from(el.selectedOptions, (o) => o.text).join(', '), 120);
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    return el.checked ? 'checked' : 'unchecked';
  }
  if (el instanceof HTMLInputElement && el.type === 'file') {
    return clean(Array.from(el.files ?? [], (f) => f.name).join(', '), 120);
  }
  return clean(el.value, 120);
}

function fmt(a: unknown): string {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

// ---------- session state ----------

function freshState(): State {
  return { id: newId(), seen: Date.now(), crumbs: [], errors: [], failed: [], sent: [] };
}

function loadState(): State {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as State | null;
    if (s?.id && Date.now() - s.seen < IDLE_MS) return { ...freshState(), ...s };
  } catch {
    // Storage blocked or corrupt: start over.
  }
  return freshState();
}

function init(): void {
  if (window.Proof) return;

  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-project][src]');
  const project = script?.dataset.project || 'default';
  const endpoint = (
    script?.dataset.endpoint || (script?.src ? new URL(script.src, location.href).origin : location.origin)
  ).replace(/\/+$/, '');
  const ingestUrl = `${endpoint}/api/ingest`;
  const isOwn = (u: string) => u.startsWith(ingestUrl) || u.startsWith(`${endpoint}/api/sessions/`);

  const state = loadState();
  const eventsUrl = `${endpoint}/api/sessions/${encodeURIComponent(state.id)}/events`;
  let unloading = false;

  const save = () => {
    state.seen = Date.now();
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Quota or privacy mode: keep working in memory.
    }
  };

  const push = (c: Crumb) => {
    state.crumbs.push(compact({ t: Date.now(), ...c }));
    if (state.crumbs.length > MAX_CRUMBS) state.crumbs.splice(0, state.crumbs.length - MAX_CRUMBS);
    save();
  };

  // ---------- rrweb replay ----------

  let events: unknown[] = [];
  try {
    const stash = JSON.parse(sessionStorage.getItem(EVENTS_KEY) ?? 'null') as { id: string; events: unknown[] } | null;
    sessionStorage.removeItem(EVENTS_KEY);
    if (stash?.id === state.id && Array.isArray(stash.events)) events = stash.events;
  } catch {
    // Nothing stashed.
  }

  const shipEvents = async (): Promise<void> => {
    if (!events.length) return;
    const batch = events;
    events = [];
    try {
      await origFetch(eventsUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ events: batch }),
      });
    } catch {
      events = batch.concat(events).slice(-5000);
    }
  };

  /** pagehide path: sendBeacon in chunks under the 64KB beacon budget; stash what does not fit for the next page. */
  const beaconEvents = () => {
    if (!events.length) return;
    let chunk: string[] = [];
    let size = 0;
    let start = 0; // first event not yet delivered
    const send = () =>
      navigator.sendBeacon(eventsUrl, new Blob([`{"events":[${chunk.join(',')}]}`], { type: 'text/plain' }));
    let i = 0;
    for (; i < events.length; i++) {
      const s = JSON.stringify(events[i]);
      if (s.length > BEACON_MAX) break;
      if (size + s.length > BEACON_MAX) {
        if (!send()) break;
        start = i;
        chunk = [];
        size = 0;
      }
      chunk.push(s);
      size += s.length + 1;
    }
    if (i === events.length && chunk.length && send()) start = i;
    const rest = events.slice(start);
    events = [];
    if (rest.length) {
      try {
        sessionStorage.setItem(EVENTS_KEY, JSON.stringify({ id: state.id, events: rest }));
      } catch {
        // Too big to stash: the replay will have a gap.
      }
    }
  };

  // ---------- incidents ----------

  const sendIncident = async (
    extra: Pick<IncidentInput, 'source'> & Partial<IncidentInput>,
    beacon = false,
  ): Promise<boolean> => {
    const incident: IncidentInput = compact({
      project,
      origin: location.origin,
      breadcrumbs: state.crumbs.slice(),
      consoleErrors: state.errors.slice(),
      failedRequests: state.failed.slice(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      userAgent: navigator.userAgent,
      replay: state.id,
      ...extra,
    });
    const body = JSON.stringify({ incident, sessionId: state.id });
    if (beacon) {
      const ok = navigator.sendBeacon(ingestUrl, new Blob([body], { type: 'text/plain' }));
      beaconEvents();
      return ok;
    }
    void shipEvents();
    try {
      const res = await origFetch(ingestUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body,
        keepalive: body.length < BEACON_MAX,
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  let timer = 0;
  let pendingSigs: string[] = [];
  const fireAuto = (beacon: boolean) => {
    window.clearTimeout(timer);
    timer = 0;
    if (!pendingSigs.length) return;
    state.sent = state.sent.concat(pendingSigs).slice(-50);
    pendingSigs = [];
    save();
    void sendIncident({ source: 'sdk' }, beacon);
  };
  /** Wait a moment so the console error that usually follows a failed fetch lands in the same incident. */
  const trigger = (sig: string) => {
    if (state.sent.includes(sig) || pendingSigs.includes(sig)) return;
    pendingSigs.push(sig);
    if (!timer) timer = window.setTimeout(() => fireAuto(false), AUTO_DELAY_MS);
  };

  const consoleError = (text: string) => {
    const t = clean(text, 500);
    if (!t || unloading) return;
    state.errors.push({ t: Date.now(), text: t });
    if (state.errors.length > MAX_ERRORS) state.errors.shift();
    save();
    trigger(`err:${t.slice(0, 120).replace(/\d+/g, '#')}`);
  };

  const failed = (method: string, url: string, status: number) => {
    if (isOwn(url) || unloading) return;
    state.failed.push({ t: Date.now(), method, url, status });
    if (state.failed.length > MAX_ERRORS) state.failed.shift();
    save();
    if (status >= 500) trigger(`req:${method} ${pathOf(url)} ${status}`);
  };

  // ---------- network + errors ----------

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = absUrl(input instanceof Request ? input.url : input);
    try {
      const res = await origFetch(input, init);
      if (res.status >= 400) failed(method, url, res.status);
      return res;
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') failed(method, url, 0);
      throw e;
    }
  };

  const xhrInfo = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  const xhrOpen = XMLHttpRequest.prototype.open as (...a: any[]) => void;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: any[]) {
    xhrInfo.set(this, { method: String(args[0]).toUpperCase(), url: absUrl(args[1]) });
    return xhrOpen.apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const info = xhrInfo.get(this);
    if (info && !isOwn(info.url)) {
      let aborted = false;
      this.addEventListener('abort', () => {
        aborted = true;
      });
      this.addEventListener('loadend', () => {
        if (!aborted && (this.status >= 400 || this.status === 0)) failed(info.method, info.url, this.status);
      });
    }
    return xhrSend.call(this, body);
  };

  const origError = console.error;
  console.error = (...args: unknown[]) => {
    try {
      consoleError(args.map(fmt).join(' '));
    } catch {
      // Never let capture break logging.
    }
    origError.apply(console, args);
  };
  window.addEventListener('error', (e) => {
    if (e.message) consoleError(e.error instanceof Error ? fmt(e.error) : e.message);
  });
  window.addEventListener('unhandledrejection', (e) => consoleError(`Unhandled rejection: ${fmt(e.reason)}`));

  // ---------- breadcrumbs ----------

  let widgetHost: HTMLElement | null = null;
  const inWidget = (t: EventTarget | null) => !!widgetHost && t instanceof Node && widgetHost.contains(t);

  let lastHref = '';
  const nav = () => {
    const href = location.href;
    if (href === lastHref) return;
    lastHref = href;
    push({ kind: 'nav', url: href });
  };
  nav();
  for (const m of ['pushState', 'replaceState'] as const) {
    const orig = history[m];
    history[m] = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = orig.apply(this, args);
      nav();
      return r;
    };
  }
  window.addEventListener('popstate', nav);
  window.addEventListener('hashchange', nav);

  let rageEl: Element | null = null;
  let rageTimes: number[] = [];
  let rageFired = false;
  const rage = (el: Element, c: Crumb) => {
    const now = Date.now();
    if (el !== rageEl || now - (rageTimes[rageTimes.length - 1] ?? 0) > 1000) {
      rageEl = el;
      rageTimes = [];
      rageFired = false;
    }
    rageTimes.push(now);
    rageTimes = rageTimes.filter((t) => now - t <= 1000);
    if (rageTimes.length >= 3 && !rageFired) {
      rageFired = true;
      push({ ...c, kind: 'rage' });
    }
  };

  // Capture phase: runs before app handlers that might navigate away, and saves synchronously.
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target;
      if (!(target instanceof Element) || inWidget(target)) return;
      const interactive = target.closest(INTERACTIVE);
      if (!interactive && target.closest('input, textarea, select, label, [contenteditable]')) return;
      const el = interactive ?? target;
      let text = '';
      if (interactive) text = nameOf(interactive);
      else {
        const raw = rendered(target).trim();
        if (raw.length <= 60) text = clean(raw);
      }
      const c: Crumb = { kind: 'click', text, selector: selectorOf(el), context: contextOf(el, text) };
      if (text) push(c);
      rage(el, c);
    },
    true,
  );

  document.addEventListener(
    'change',
    (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement))
        return;
      if (inWidget(t)) return;
      if (t instanceof HTMLInputElement && ['hidden', 'submit', 'button', 'reset', 'image'].includes(t.type)) return;
      const label = labelOf(t);
      push({ kind: 'input', label, value: fieldValue(t), selector: selectorOf(t), context: contextOf(t, label) });
    },
    true,
  );

  // Submits without a click (Enter key). Clicked submits already have a click crumb.
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || inWidget(form)) return;
      const last = state.crumbs[state.crumbs.length - 1];
      if (last?.kind === 'click' && Date.now() - last.t < 1000) return;
      const sub = (e as SubmitEvent).submitter;
      const text =
        (sub && nameOf(sub)) ||
        clean(form.getAttribute('aria-label') || form.getAttribute('name') || form.getAttribute('id'));
      push({ kind: 'submit', text, selector: selectorOf(form), context: contextOf(form, text) });
    },
    true,
  );

  // ---------- replay recording + shipping ----------

  try {
    record({
      emit: (ev) => {
        events.push(ev);
        if (events.length > 1000) void shipEvents();
      },
      maskInputOptions: { password: true },
      recordCanvas: false,
      checkoutEveryNms: 30_000,
      blockClass: 'rr-block',
    });
  } catch {
    // Replay is best effort; breadcrumbs still work.
  }
  window.setInterval(() => void shipEvents(), SHIP_EVERY_MS);

  const leave = () => {
    if (timer) fireAuto(true);
    beaconEvents();
    save();
  };
  window.addEventListener('pagehide', () => {
    leave();
    unloading = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
  });

  // ---------- public API + widget ----------

  const report = (text: string, email?: string) =>
    sendIncident({
      source: 'widget',
      report: text.trim().slice(0, 4000),
      reporter: email ? { email: clean(email, 200) } : undefined,
    });

  window.Proof = {
    report,
    flush: async () => {
      if (timer) fireAuto(false);
      await shipEvents();
    },
    sessionId: state.id,
  };

  if (script?.dataset.widget !== 'off') {
    const mount = () => {
      widgetHost = mountWidget(report);
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }
}

// ---------- widget ----------

const WIDGET_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
[hidden] { display: none !important; }
.pill { border: 0; border-radius: 999px; padding: 6px 12px; background: rgba(20, 20, 20, .78); color: #fff; cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .18); opacity: .8; font-size: 12px; }
.pill:hover, .pill:focus-visible { opacity: 1; }
.panel { width: 280px; background: #fff; color: #1a1a1a; border-radius: 12px; padding: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, .22); border: 1px solid rgba(0, 0, 0, .08); }
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 600; }
.x { border: 0; background: none; cursor: pointer; font-size: 16px; color: #666; padding: 0 4px; }
form { display: grid; gap: 8px; }
textarea, input { width: 100%; border: 1px solid #d6d6d6; border-radius: 8px; padding: 7px 9px; background: #fff; color: #1a1a1a; }
textarea { resize: vertical; min-height: 72px; }
.send { border: 0; border-radius: 8px; padding: 8px; background: #1a1a1a; color: #fff; cursor: pointer; font-weight: 600; }
.send:disabled { opacity: .6; cursor: default; }
.msg { margin: 0; color: #b42a2a; font-size: 12px; }
.thanks { margin: 4px 0; font-weight: 600; color: #2f6b3a; }
`;

const WIDGET_HTML = `<style>${WIDGET_CSS}</style>
<button type="button" class="pill">Report a bug</button>
<div class="panel" role="dialog" aria-label="Report a bug" hidden>
  <div class="head"><span>Report a bug</span><button type="button" class="x" aria-label="Close">&times;</button></div>
  <form novalidate>
    <textarea name="report" rows="4" placeholder="What went wrong?" aria-label="What went wrong?"></textarea>
    <input name="email" type="email" placeholder="Email (optional)" aria-label="Email (optional)">
    <button type="submit" class="send">Send</button>
    <p class="msg" hidden></p>
  </form>
  <p class="thanks" hidden>Thanks, we are on it.</p>
</div>`;

function mountWidget(report: (text: string, email?: string) => Promise<boolean>): HTMLElement {
  const host = document.createElement('div');
  host.id = 'proof-widget';
  host.className = 'rr-block';
  host.setAttribute('style', 'all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483000;');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = WIDGET_HTML;
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T;
  const pill = $<HTMLButtonElement>('.pill');
  const panel = $<HTMLDivElement>('.panel');
  const form = $<HTMLFormElement>('form');
  const textarea = $<HTMLTextAreaElement>('textarea');
  const email = $<HTMLInputElement>('input');
  const send = $<HTMLButtonElement>('.send');
  const msg = $<HTMLParagraphElement>('.msg');
  const thanks = $<HTMLParagraphElement>('.thanks');

  const open = (on: boolean) => {
    panel.hidden = !on;
    pill.hidden = on;
    if (on) textarea.focus();
  };
  const reset = () => {
    form.reset();
    form.hidden = false;
    thanks.hidden = true;
    msg.hidden = true;
    send.disabled = false;
    send.textContent = 'Send';
  };
  pill.addEventListener('click', () => open(true));
  $<HTMLButtonElement>('.x').addEventListener('click', () => {
    open(false);
    reset();
  });
  // Keep host-page hotkeys from eating keystrokes typed into the report.
  for (const k of ['keydown', 'keyup', 'keypress']) panel.addEventListener(k, (e) => e.stopPropagation());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) {
      textarea.focus();
      return;
    }
    send.disabled = true;
    send.textContent = 'Sending...';
    msg.hidden = true;
    const ok = await report(text, email.value.trim() || undefined);
    if (ok) {
      form.hidden = true;
      thanks.hidden = false;
      window.setTimeout(() => {
        open(false);
        reset();
      }, 4000);
    } else {
      send.disabled = false;
      send.textContent = 'Send';
      msg.textContent = 'Could not send. Please try again.';
      msg.hidden = false;
    }
  });
  document.body.appendChild(host);
  return host;
}

try {
  init();
} catch (e) {
  // The SDK must never break the host page.
  console.warn('[proof] init failed', e);
}
