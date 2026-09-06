import { expect, test } from 'vitest';

function normalizeParams(obj) {
  const s = [];
  Object.keys(obj).sort().forEach(k => {
    s.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
  });
  return s.join('&');
}

test('normalizes and sorts parameters alphabetically for OAuth', () => {
  const params = { z_param: 'last', a_param: 'first', b_param: 'space here' };
  expect(normalizeParams(params)).toBe('a_param=first&b_param=space%20here&z_param=last');
});