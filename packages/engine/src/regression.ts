// One regression test, isolated. Kane's default Chrome profile persists cookies, and cookies ignore
// ports, so candidates judged side by side on localhost would share one cart.

import { runTestmd, type TestmdRun } from '@proof/kane';
import { launchChrome } from '@proof/recorder';

async function once(file: string, url: string): Promise<TestmdRun> {
  const chrome = await launchChrome();
  try {
    return await runTestmd(file, { url, cdpEndpoint: chrome.endpoint });
  } finally {
    await chrome.close();
  }
}

/** A red test is run once more: a real break fails twice, a browser hiccup does not. */
export async function runRegression(file: string, url: string): Promise<TestmdRun & { attempts: number }> {
  const first = await once(file, url);
  if (first.status === 'passed') return { ...first, attempts: 1 };
  return { ...(await once(file, url)), attempts: 2 };
}
