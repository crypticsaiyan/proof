// Cheap-model calls for triage and objective writing. Default: Claude Haiku through the local
// `claude` CLI (uses the developer's existing login, no API key). Set PROOF_LLM=off to force the
// deterministic fallbacks, which every caller must provide.

import { spawn } from 'node:child_process';

export const LLM_MODEL = process.env.PROOF_LLM_MODEL ?? 'haiku';

export function llmEnabled(): boolean {
  return process.env.PROOF_LLM !== 'off';
}

export async function askJson<T>(prompt: string, schema: object, opts: { timeoutMs?: number } = {}): Promise<T> {
  const args = [
    '-p',
    '--model',
    LLM_MODEL,
    '--output-format',
    'json',
    '--no-session-persistence',
    '--tools',
    '',
    '--json-schema',
    JSON.stringify(schema),
    prompt,
  ];
  const out = await new Promise<string>((res, rej) => {
    const p = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => {
      stdout += d;
    });
    p.stderr.on('data', (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => p.kill('SIGTERM'), opts.timeoutMs ?? 90_000);
    p.on('error', rej);
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code) rej(new Error(`claude exited ${code}: ${stderr.slice(-400)}`));
      else res(stdout);
    });
  });
  const j = JSON.parse(out);
  if (j.is_error) throw new Error(`llm error: ${String(j.result).slice(0, 300)}`);
  return (j.structured_output ?? JSON.parse(j.result)) as T;
}
