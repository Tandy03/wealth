const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect, normalize } = require('../../frontend/js/rebalance/model');

test('allocation editing rejects invalid or excessive precision and preserves the existing total tolerance', () => {
  assert.equal(inspect(['33.3', '33.3', '33.4']).valid, true);
  for (const values of [[], ['', 100], [' ', 100], [NaN, 100], [Infinity, 0], [-1, 101], [50.05, 49.95], [true, 99], [null, 100], [99.9], [100.1]]) assert.equal(inspect(values).valid, false);
});

test('normalization uses largest remainders, preserves zeros and never changes the input', () => {
  const input = [1, 1, 1, 0];
  assert.deepEqual(normalize(input), [33.4, 33.3, 33.3, 0]);
  assert.deepEqual(input, [1, 1, 1, 0]);
  assert.deepEqual(normalize([0, 100, 0]), [0, 100, 0]);
  assert.deepEqual(normalize([80, 80]), [50, 50]);
  assert.throws(() => normalize([0, 0]), /positive/);
  assert.throws(() => normalize(['', 50]), /0.1/);
  for (let count = 1; count <= 80; count++) {
    const weights = Array.from({ length: count }, (_, index) => index % 4 ? ((index * 37 + count) % 1000 + 1) / 10 : 0);
    if (!weights.some(Boolean)) weights[0] = 0.1;
    const normalized = normalize(weights);
    assert.equal(normalized.reduce((sum, value) => sum + Math.round(value * 10), 0), 1000);
    assert.equal(inspect(normalized).valid, true);
    weights.forEach((value, index) => { if (value === 0) assert.equal(normalized[index], 0); });
  }
});
