import { expect, test } from 'vitest';

test('extracts username from flickr profile URL pattern', () => {
  const extractUsername = (href) => {
    const m = href.match(/\/photos\/([^\/]+)/);
    return m ? m[1] : null;
  };
  expect(extractUsername('/photos/example_user/12345/')).toBe('example_user');
  expect(extractUsername('/photos/user.name')).toBe('user.name');
});