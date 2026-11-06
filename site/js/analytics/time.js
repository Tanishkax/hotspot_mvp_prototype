export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** Month index relative to January of baseYear (Jan baseYear = 0). month is 1-12. */
export function ymToIndex(year, month, baseYear) {
  return (year - baseYear) * 12 + (month - 1);
}

export function indexToYM(m, baseYear) {
  return { year: baseYear + Math.floor(m / 12), month: (m % 12) + 1 };
}

export function labelYM(m, baseYear, long = false) {
  const { year, month } = indexToYM(m, baseYear);
  return `${(long ? MONTH_LONG : MONTH_SHORT)[month - 1]} ${year}`;
}

/** Parse "YYYY-MM" into a month index. */
export function parseYM(s, baseYear) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(s));
  if (!match) throw new Error(`Invalid year-month: ${s}`);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid month: ${s}`);
  return ymToIndex(Number(match[1]), month, baseYear);
}

/** Clamp and order a [start, end] month-index range to [min, max]. Returns null if empty. */
export function normaliseRange(start, end, min, max) {
  let a = Math.max(min, Math.min(start, end));
  let b = Math.min(max, Math.max(start, end));
  if (a > b) return null;
  return [a, b];
}

export function inRange(m, range) {
  return m >= range[0] && m <= range[1];
}
