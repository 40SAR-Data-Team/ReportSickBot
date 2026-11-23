import { TZ } from './consts.js';

/** Today's date in TZ as DD/MM/YYYY. */
export const today = () => new Date().toLocaleDateString('en-GB', { timeZone: TZ });
/** Typed "DDMMYY[ HHMM]" as "DD/MM/YYYY[ HHMM]", the stored and shown form. Anything else passes through. */
export const expand = (text) => text.replace(/^(\d\d)(\d\d)(\d\d)(?= |$)/, '$1/$2/20$3');
/**
 * Parses "DD/MM/YYYY", or "DD/MM/YYYY HHMM" when `withTime`.
 *
 * @param {string} text Input to parse.
 * @param {boolean} withTime Whether a time part is required (and only then allowed).
 * @return {Date|null} UTC wall-clock date, or null if malformed or not a real date.
 */
export function parseDateTime(text, withTime) {
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{2}):?(\d{2}))?$/);
  if (!m || withTime !== (m[4] !== undefined)) return null;
  const [d, mo, y, h = 0, mi = 0] = m.slice(1).map((v) => (v === undefined ? undefined : +v));
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const valid = date.getUTCDate() === d && date.getUTCMonth() === mo - 1 && h < 24 && mi < 60;
  return valid ? date : null;
}
