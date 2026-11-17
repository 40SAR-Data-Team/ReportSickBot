/** Today's date in Singapore as DD/MM/YYYY. */
export const today = () => new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore' });
/** Parses "DD/MM/YYYY" (or "DD/MM/YYYY HHMM" if withTime); returns a Date or null if invalid. */
export function parseDateTime(text, withTime) {
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{2}):?(\d{2}))?$/);
  if (!m || withTime !== (m[4] !== undefined)) return null;
  const [d, mo, y, h = 0, mi = 0] = m.slice(1).map((v) => (v === undefined ? undefined : +v));
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const valid = date.getUTCDate() === d && date.getUTCMonth() === mo - 1 && h < 24 && mi < 60;
  return valid ? date : null;
}

/** Start of today in Singapore, on the same wall-clock-as-UTC scale as parseDateTime. */
export const today0 = () => parseDateTime(today(), false);
/** "DDMMYY" -> "DD/MM/20YY"; anything else is returned unchanged. */
export const ddmmyy = (t) => t.replace(/^(\d\d)(\d\d)(\d\d)$/, '$1/$2/20$3');
export const YEAR = 366 * 86400e3;
