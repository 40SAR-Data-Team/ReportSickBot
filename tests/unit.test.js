import { expect, test } from 'bun:test';
import { invalid, parseDateTime } from '../api/webhook.js';

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

test('invalid', () => {
  expect(invalid('name', '/new', {})).toContain('Commands');
  expect(invalid('condition', '/start fever', {})).toContain('Commands');
  expect(invalid('name', 'Ravi s/o Kumar', {})).toBeNull();
  expect(invalid('name', "Muhammad Hafiz bin Ali-O'Neil", {})).toBeNull();
  expect(invalid('name', 'Tan123', {})).toContain('letters only');
  expect(invalid('name', 'x'.repeat(61), {})).toContain('letters only');
  expect(invalid('condition', '...', {})).toContain('in words');
  expect(invalid('clinic', 'Kranji Medical Centre', {})).toBeNull();
  expect(invalid('start', '13/10/2026', { end: '12/10/2026' })).toContain('after the end');
  expect(invalid('end', '09/10/2026', { start: '10/10/2026' })).toContain('before the start');
});
