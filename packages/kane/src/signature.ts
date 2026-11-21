// Error signatures: how we decide two failures are "the same bug".
//
// Sources: Kane's run_end evidence lines (bug detection), the evidence pack's HAR and console
// log, and the user's captured session. Hosts are dropped so localhost, preview and prod match.

export type Signature = {
  /** Kane reason code, e.g. assertion_error.confirmed_product_bug */
  reasonCode?: string;
  /** "POST /api/checkout 500" */
  http: string[];
  /** Normalized console error texts. */
  console: string[];
};

export const emptySignature = (): Signature => ({ http: [], console: [] });

export function httpKey(method: string, url: string, status: number | string): string {
  let path = url;
  try {
    path = new URL(url, 'http://x').pathname;
  } catch {}
  return `${method.toUpperCase()} ${path} ${status}`;
}

const NOISE = [/favicon\.ico/i, /chrome-extension:/i, /\[proof-sdk\]/i];

export function normalizeConsole(text: string): string {
  return text
    .replace(/https?:\/\/[^/\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Parse `evidence: http_error_response|network_failure: POST http://h/api/x -> 500 body: ...` lines. */
export function fromEvidenceLines(text: string | undefined): Signature {
  const sig = emptySignature();
  if (!text) return sig;
  for (const m of text.matchAll(/(?:http_error_response|network_failure):\s*([A-Z]+)\s+(\S+)\s+->\s+(\d{3})/g)) {
    sig.http.push(httpKey(m[1], m[2], m[3]));
  }
  for (const m of text.matchAll(/console_error:\s*(.+)/g)) {
    sig.console.push(normalizeConsole(m[1]));
  }
  return dedupe(sig);
}

/** From an evidence pack's HAR entries and console NDJSON. */
export function fromPackLogs(har: any, consoleNdjson: string): Signature {
  const sig = emptySignature();
  for (const e of har?.log?.entries ?? []) {
    const status = e?.response?.status ?? 0;
    const url = String(e?.request?.url ?? '');
    if (status >= 500 || (status >= 400 && !NOISE.some((n) => n.test(url)) && /\/api\//.test(url))) {
      sig.http.push(httpKey(e.request.method ?? 'GET', url, status));
    }
  }
  for (const line of consoleNdjson.split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.level !== 'error' || typeof ev.text !== 'string') continue;
      if (NOISE.some((n) => n.test(`${ev.text} ${ev.url ?? ''}`))) continue;
      if (/^Failed to load resource/.test(ev.text)) continue; // covered by HAR
      sig.console.push(normalizeConsole(ev.text));
    } catch {}
  }
  return dedupe(sig);
}

export function merge(...sigs: Signature[]): Signature {
  return dedupe({
    reasonCode: sigs.find((s) => s.reasonCode)?.reasonCode,
    http: sigs.flatMap((s) => s.http),
    console: sigs.flatMap((s) => s.console),
  });
}

function dedupe(s: Signature): Signature {
  return { ...s, http: [...new Set(s.http)], console: [...new Set(s.console)] };
}

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);

function similar(a: string, b: string): boolean {
  if (a.includes(b) || b.includes(a)) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let both = 0;
  for (const t of ta) if (tb.has(t)) both++;
  return both / Math.min(ta.size, tb.size) >= 0.6;
}

export type Match = { matched: boolean; why: string };

/**
 * Does `actual` (a Kane failure) show the same bug as `expected` (the user's session)?
 * HTTP failures are the strongest signal; console errors are the fallback.
 */
export function matchSignature(expected: Signature, actual: Signature): Match {
  const http = expected.http.filter((h) => actual.http.includes(h));
  if (http.length) return { matched: true, why: `same failed request: ${http.join(', ')}` };
  const con = expected.console.filter((e) => actual.console.some((a) => similar(e, a)));
  if (con.length) return { matched: true, why: `same console error: ${con[0]}` };
  if (!expected.http.length && !expected.console.length && actual.reasonCode?.includes('product_bug')) {
    return { matched: true, why: 'Kane confirmed a product bug (no client signature to compare)' };
  }
  const saw = [...actual.http, ...actual.console].slice(0, 3).join('; ') || 'no errors';
  return { matched: false, why: `different failure (saw: ${saw})` };
}
