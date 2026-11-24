import assert from 'node:assert/strict';
import { test } from 'node:test';
import { neutralStep } from '../src/objective.ts';

test('state the bug produced never becomes part of the locked test', () => {
  assert.equal(neutralStep('Click "Place order · -$2.01"'), 'Click "Place order"');
  assert.equal(neutralStep('Click "Cart (3)" (opens /cart)'), 'Click "Cart" (opens /cart)');
  assert.equal(neutralStep('Click "Pay 1,200.50 EUR"'), 'Click "Pay"');
  assert.equal(neutralStep('Click "Apply" (opens /cart?notice=Code%20applied)'), 'Click "Apply" (opens /cart)');
});

test('user input and plain labels are untouched', () => {
  assert.equal(neutralStep('Type "$20" into the "Amount" field'), 'Type "$20" into the "Amount" field');
  assert.equal(
    neutralStep('Click "Add to cart" for "Tea Tin" (opens /cart)'),
    'Click "Add to cart" for "Tea Tin" (opens /cart)',
  );
  assert.equal(neutralStep('Click "$5"'), 'Click "$5"');
  assert.equal(
    neutralStep('Type "WELCOME20" into the "Discount code" field'),
    'Type "WELCOME20" into the "Discount code" field',
  );
});

test('patch review needs two of three votes', async () => {
  const { tally } = await import('../src/review.ts');
  const v = (verdict: 'root-cause' | 'masks-symptom' | 'unreviewed') => ({ verdict, why: 'x' });
  assert.equal(tally([v('masks-symptom'), v('root-cause'), v('root-cause')]).verdict, 'root-cause');
  assert.equal(tally([v('masks-symptom'), v('masks-symptom'), v('root-cause')]).verdict, 'masks-symptom');
  assert.equal(tally([v('masks-symptom'), v('root-cause'), v('unreviewed')]).verdict, 'unreviewed');
});
