// Minimal Chrome DevTools Protocol client over the built-in WebSocket (flat sessions).

type Handler = (params: any, sessionId?: string) => void;

export class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  private handlers = new Map<string, Handler[]>();
  readonly ready: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error(`CDP websocket error: ${url}`));
    });
    this.ws.onclose = () => {
      for (const p of this.pending.values()) p.rej(new Error('CDP connection closed'));
      this.pending.clear();
    };
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message));
        else p.res(msg.result);
        return;
      }
      for (const h of this.handlers.get(msg.method) ?? []) h(msg.params, msg.sessionId);
    };
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }

  on(method: string, h: Handler): void {
    this.handlers.set(method, [...(this.handlers.get(method) ?? []), h]);
  }

  close(): void {
    this.ws.close();
  }
}
