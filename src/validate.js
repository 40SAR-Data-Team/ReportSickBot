import { parseDateTime, today } from './dates.js';
import { EG } from './form.js';

/** One year in milliseconds, the cap for how far a date may sit from today. */
const YEAR = 366 * 86400e3;
/** Start of today in Singapore, on the same wall-clock-as-UTC scale as parseDateTime. */
const today0 = () => parseDateTime(today(), false);

/** Free-text steps that must contain letters. */
const WORDS = new Set(['condition', 'clinic', 'purpose', 'venue', 'reason']);
/**
 * Validates a typed answer.
 *
 * @param {string} step Form step being answered.
 * @param {string} text Trimmed user input.
 * @param {object} s Form state so far (for start/end cross-checks).
 * @return {string|null} Error message to show the user, or null if valid.
 */
export function invalid(step, text, s) {
  if (!text) return 'Please type your answer.';
  if (text.startsWith('/')) return 'Commands are not valid answers. Send /start to restart, or /cancel to stop.';
  // keeps the admin summary under Telegram's 4096-char message limit
  if (text.length > 500) return 'Too long, please keep it under 500 characters.';
  if (step === 'name' && !/^[A-Za-z][A-Za-z .'\/@-]{0,59}$/.test(text)) return 'Please type your name in letters only (e.g. Tan Ah Kow).';
  if (WORDS.has(step) && !/[A-Za-z]/.test(text)) return 'Please describe it in words.';
  if (step === 'formsg' && !/^[0-9a-f]{24}$/i.test(text)) return `Invalid Response ID, e.g. ${EG}`;
  if (step === 'time' && !parseDateTime(`${today()} ${text}`, true)) return 'Invalid time. Use 24h, e.g. 0830.';
  if (step === 'when') {
    const when = parseDateTime(text, true);
    if (!when) return 'Invalid date/time. Use DD/MM/YYYY HHMM, e.g. 25/12/2026 0930.';
    if (when < today0()) return 'The appointment cannot be in the past.';
    if (when - today0() > YEAR) return 'The appointment is too far ahead.';
  }
  if (step !== 'start' && step !== 'end' && step !== 'onset') return null;
  const date = parseDateTime(text.replace(/^(\d\d)(\d\d)(\d\d)$/, '$1/$2/20$3'), false); // onset is DDMMYY
  if (!date) return step === 'onset' ? 'Invalid date. Use DDMMYY, e.g. 151126.' : 'Invalid date. Use DD/MM/YYYY.';
  if (Math.abs(date - today0()) > YEAR) return 'That date is too far from today.';
  if (step === 'onset' && date > today0()) return 'The date cannot be in the future.';
  if (step === 'end') {
    const start = parseDateTime(s.start, false);
    if (date - start > YEAR) return 'MC / Status cannot be longer than a year.';
    if (date < start) return 'End date cannot be before the start date.';
  }
  if (step === 'start' && s.end && date > parseDateTime(s.end, false)) return 'Start date cannot be after the end date.';
  return null;
}
