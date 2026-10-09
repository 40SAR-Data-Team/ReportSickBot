import { expect, test } from 'bun:test';
import { parseDateTime } from '../api/webhook.js';

test('parseDateTime', () => {
  expect(parseDateTime('10/10/2026 0830', true)).toEqual(new Date(Date.UTC(2026, 9, 10, 8, 30)));
  expect(parseDateTime('1/2/2026', false)).toEqual(new Date(Date.UTC(2026, 1, 1)));
  expect(parseDateTime('31/02/2026', false)).toBeNull();
  expect(parseDateTime('10/10/2026 2460', true)).toBeNull();
  expect(parseDateTime('10/10/2026', true)).toBeNull(); // time required
  expect(parseDateTime('10/10/2026 0830', false)).toBeNull(); // time not allowed
  expect(parseDateTime('2026-10-10', false)).toBeNull();
  expect(parseDateTime('01/10/2026', false) < parseDateTime('10/10/2026', false)).toBe(true);
});
