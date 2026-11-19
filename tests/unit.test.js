import { expect, setSystemTime, test } from 'bun:test';
import { parseDateTime, today } from '../src/dates.js';
import { invalid } from '../src/validate.js';
import { APPT_DAY, TOMORROW } from './fake.js';

test.each([
  ['1/2/2026', false, Date.UTC(2026, 1, 1)], // single-digit day and month
  ['29/02/2028', false, Date.UTC(2028, 1, 29)], // leap year
  ['29/02/2026', false, null],
  ['31/04/2026', false, null],
  ['00/10/2026', false, null],
  ['10/13/2026', false, null],
  ['10/10/26', false, null],
  [' 10/10/2026', false, null],
  ['2026-10-10', false, null],
  ['10/10/2026', true, null], // time required
  ['10/10/2026 0830', false, null], // time not allowed
  ['10/10/2026 0830', true, Date.UTC(2026, 9, 10, 8, 30)],
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
  ['condition', '/start fever', {}, 'Commands'],
  ['clinic', 'x'.repeat(501), {}, 'under 500'],
  ['condition', 'x'.repeat(500), {}, null],
  ['name', 'Ravi s/o Kumar', {}, null],
  ['name', "Muhammad Hafiz bin Ali-O'Neil", {}, null],
  ['name', 'Tan123', {}, 'letters only'],
  ['name', '-Tan', {}, 'letters only'],
  ['name', 'x'.repeat(60), {}, null],
  ['name', 'x'.repeat(61), {}, 'letters only'],
  ['condition', '38.5', {}, 'in words'],
  ['condition', 'Fever 38.5', {}, null],
  ['onset', '151126x', {}, 'Use DDMMYY'],
  ['onset', '311126', {}, 'Invalid date'],
  ['onset', TOMORROW, {}, 'cannot be in the future'],
  ['onset', '010199', {}, 'too far'],
  ['formsg', '6AD8500B1D0AE72F026CFA75', {}, null],
  ['formsg', '6ad8500b1d0ae72f026cfa7', {}, 'Invalid Response ID'],
  ['formsg', 'zad8500b1d0ae72f026cfa75', {}, 'Invalid Response ID'],
  ['time', '0830', {}, null],
  ['time', '08:30', {}, null],
  ['time', '2500', {}, 'Invalid time'],
  ['time', 'tomorrow', {}, 'Invalid time'],
  ['when', `${APPT_DAY} 1400`, {}, null],
  ['when', APPT_DAY, {}, 'Invalid date/time'],
  ['when', '01/01/2020 1400', {}, 'in the past'],
  ['when', '01/01/2099 1400', {}, 'too far ahead'],
  ['start', '01/01/2099', {}, 'too far from today'],
  ['end', APPT_DAY, { start: '01/01/2000' }, 'longer than a year'],
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

test('today() rolls over at Singapore midnight, not UTC', () => {
  try {
    setSystemTime(new Date('2026-11-19T15:59:00Z'));
    expect(today()).toBe('19/11/2026');
    setSystemTime(new Date('2026-11-19T16:00:00Z'));
    expect(today()).toBe('20/11/2026');
  } finally {
    setSystemTime();
  }
});

test('fuzz: random input never throws', () => {
  const chars = '0123456789/: aZ-.';
  const steps = ['name', 'condition', 'onset', 'time', 'when', 'start', 'end', 'formsg'];
  for (let i = 0; i < 2000; i++) {
    const t = Array.from({ length: Math.random() * 20 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    expect(() => parseDateTime(t, i % 2 === 0)).not.toThrow();
    for (const step of steps) expect(() => invalid(step, t, { start: '10/10/2026', end: '12/10/2026' })).not.toThrow();
  }
});
