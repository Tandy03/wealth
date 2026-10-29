
const implementation = (function () {
  function inspect(rawValues) {
    const values = rawValues.map(value => !['number', 'string'].includes(typeof value) || value === '' || String(value).trim() === '' ? NaN : Number(value));
    const invalid = values.map(value => !Number.isFinite(value) || value < 0 || value > 100 || Math.abs(value * 10 - Math.round(value * 10)) > 1e-6);
    const total = values.reduce((sum, value, index) => sum + (invalid[index] ? 0 : value), 0);
    return { values, invalid, total, valid: values.length > 0 && !invalid.some(Boolean) && Math.abs(total - 100) <= 0.01 };
  }
  function normalize(rawValues) {
    const state = inspect(rawValues);
    if (state.invalid.some(Boolean)) throw new Error('Enter target shares from 0 to 100 in steps of 0.1.');
    if (!(state.total > 0)) throw new Error('Enter at least one positive target before normalizing.');
    const scaled = state.values.map(value => value / state.total * 1000);
    const units = scaled.map(Math.floor);
    const order = scaled.map((value, index) => ({ index, remainder: value - units[index] })).filter(item => state.values[item.index] > 0)
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    const remainder = 1000 - units.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < remainder; index++) units[order[index % order.length].index]++;
    return units.map(value => value / 10);
  }
  return { inspect, normalize };
})();
export default implementation;
export const { inspect, normalize } = implementation;
