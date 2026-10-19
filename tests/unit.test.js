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

test.each([
  ['29/02/2028', false, Date.UTC(2028, 1, 29)], // leap year
  ['29/02/2026', false, null],
  ['31/04/2026', false, null],
  ['00/10/2026', false, null],
  ['10/13/2026', false, null],
  ['10/10/26', false, null],
  [' 10/10/2026', false, null],
  ['10/10/2026 08:30', true, Date.UTC(2026, 9, 10, 8, 30)],
  ['10/10/2026 0000', true, Date.UTC(2026, 9, 10)],
  ['10/10/2026 2359', true, Date.UTC(2026, 9, 10, 23, 59)],
  ['10/10/2026 2400', true, null],
  ['10/10/2026 830', true, null],
])('parseDateTime(%p, %p)', (text, withTime, ms) => {
  expect(parseDateTime(text, withTime)?.getTime() ?? null).toBe(ms);
});

// [step, answer, form state, expected error substring, or null if valid]
test.each([
  ['name', '', {}, 'type your answer'],
  ['name', '/new', {}, 'Commands'],
  ['condition', '/start fever', {}, 'Commands'],
  ['clinic', 'x'.repeat(501), {}, 'under 500'],
  ['condition', 'x'.repeat(500), {}, null],
  ['name', 'Ravi s/o Kumar', {}, null],
  ['name', "Muhammad Hafiz bin Ali-O'Neil", {}, null],
  ['name', 'Tan A. K.', {}, null],
  ['name', 'Tan123', {}, 'letters only'],
  ['name', '-Tan', {}, 'letters only'],
  ['name', 'Tan_Ah_Kow', {}, 'letters only'],
  ['name', 'x'.repeat(60), {}, null],
  ['name', 'x'.repeat(61), {}, 'letters only'],
  ['condition', '...', {}, 'in words'],
  ['condition', '38.5', {}, 'in words'],
  ['condition', 'Fever 38.5', {}, null],
  ['clinic', 'Kranji Medical Centre', {}, null],
  ['purpose', '???', {}, 'in words'],
  ['venue', '42', {}, 'in words'],
  ['reason', 'LD 2 days', {}, null],
  ['time', '0830', {}, null],
  ['time', '08:30', {}, null],
  ['time', '2500', {}, 'Invalid time'],
  ['time', 'tomorrow', {}, 'Invalid time'],
  ['when', '20/10/2026 1400', {}, null],
  ['when', '20/10/2026', {}, 'Invalid date/time'],
  ['start', '10/10/2026', {}, null],
  ['start', '10/10/2026 0830', {}, 'Invalid date'],
  ['start', '13/10/2026', { end: '12/10/2026' }, 'after the end'],
  ['start', '12/10/2026', { end: '12/10/2026' }, null],
  ['end', '09/10/2026', { start: '10/10/2026' }, 'before the start'],
  ['end', '10/10/2026', { start: '10/10/2026' }, null],
  ['end', '31/02/2026', { start: '10/10/2026' }, 'Invalid date'],
])('invalid(%p, %p)', (step, text, s, err) => {
  if (err) expect(invalid(step, text, s)).toContain(err);
  else expect(invalid(step, text, s)).toBeNull();
});
