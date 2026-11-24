import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ddmin, shrink } from '../src/minimize.ts';

const key = (xs: number[]) => xs.join(',');

test('ddmin finds the 1-minimal failing subsequence', async () => {
  const items = Array.from({ length: 12 }, (_, i) => i + 1);
  // Bug needs 4 steps (e.g. add item, open cart, apply code, place order).
  const need = [3, 6, 10, 12];
  let calls = 0;
  const fails = async (xs: number[]) => {
    calls++;
    return need.every((n) => xs.includes(n));
  };
  const min = await ddmin(items, fails, { key, parallel: 4 });
  assert.deepEqual(min, need);
  assert.ok(calls < 80, `too many checks: ${calls}`);
});

test('ddmin keeps everything when every step matters', async () => {
  const items = [1, 2, 3];
  const min = await ddmin(items, async (xs) => xs.length === 3, { key });
  assert.deepEqual(min, [1, 2, 3]);
});

test('ddmin respects budget', async () => {
  let calls = 0;
  const min = await ddmin(
    [1, 2, 3, 4, 5, 6, 7, 8],
    async (xs) => {
      calls++;
      return xs.includes(8);
    },
    { key, budget: () => calls < 2 },
  );
  assert.ok(min.includes(8));
  assert.ok(calls <= 3);
});

test('shrink: correct hint costs 1 + k checks', async () => {
  const items = Array.from({ length: 12 }, (_, i) => i + 1);
  const need = [3, 6, 10, 12];
  let calls = 0;
  const fails = async (xs: number[]) => {
    calls++;
    return need.every((n) => xs.includes(n));
  };
  assert.deepEqual(await shrink(items, need, fails, { key, parallel: 4 }), need);
  assert.equal(calls, 1 + need.length);
});

test('shrink: over-wide hint is trimmed, wrong hint falls back to ddmin', async () => {
  const items = Array.from({ length: 10 }, (_, i) => i + 1);
  const need = [2, 7];
  const fails = async (xs: number[]) => need.every((n) => xs.includes(n));
  assert.deepEqual(await shrink(items, [1, 2, 5, 7], fails, { key }), need);
  assert.deepEqual(await shrink(items, [1, 3], fails, { key }), need);
});

test('withNavigation re-inserts the click that reaches a step page', async () => {
  const { withNavigation } = await import('../src/minimize.ts');
  const all = [
    { id: 1, text: 'Click "Add to cart" for "Tea Tin" (opens /cart)' },
    { id: 2, text: 'Type "WELCOME20" into the "Discount code" field' },
    { id: 3, text: 'Click "Apply"' },
    { id: 4, text: 'Click "Checkout" (opens /checkout)' },
    { id: 5, text: 'Type "maya@example.com" into the "Email for receipt" field' },
    { id: 6, text: 'Click "Place order"' },
  ];
  const pick = (ids: number[]) => all.filter((s) => ids.includes(s.id));
  assert.deepEqual(
    withNavigation(pick([1, 2, 3, 5, 6]), all).map((s) => s.id),
    [1, 2, 3, 4, 5, 6],
  );
  // Typing the code needs /cart: the add-to-cart click that lands there comes back.
  assert.deepEqual(
    withNavigation(pick([2, 3, 4, 5, 6]), all).map((s) => s.id),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    withNavigation(pick([1, 4, 6]), all).map((s) => s.id),
    [1, 4, 6],
  );
});
