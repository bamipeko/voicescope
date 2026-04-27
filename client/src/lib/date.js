/**
 * Parse a date string from the database into a proper Date object.
 *
 * SQLite CURRENT_TIMESTAMP returns UTC without timezone suffix ('2026-04-07 14:30:00').
 * Server-generated ISO strings have 'Z' suffix ('2026-04-07T14:30:00.000Z').
 * This function normalizes both to correct Date objects so that
 * toLocaleString() displays in the user's local timezone (e.g. JST).
 */
export function parseDate(str) {
  if (!str) return null
  // Already has timezone info (Z or +HH:MM) — parse directly
  if (/[Z+\-]\d{0,2}:?\d{0,2}$/.test(str)) return new Date(str)
  // SQLite CURRENT_TIMESTAMP format: 'YYYY-MM-DD HH:MM:SS' (UTC, no timezone)
  // Append 'Z' to ensure JavaScript treats it as UTC
  return new Date(str.replace(' ', 'T') + 'Z')
}

/**
 * Format a date string for display in Japanese locale.
 * Full format: 2026/04/07 23:30
 */
export function formatDateTime(str) {
  const d = parseDate(str)
  if (!d || isNaN(d)) return ''
  return d.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Format a date string for display — short format.
 * e.g. 4/7 23:30
 */
export function formatDateTimeShort(str) {
  const d = parseDate(str)
  if (!d || isNaN(d)) return ''
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Format a date string — date only.
 * e.g. 2026/04/07
 */
export function formatDateOnly(str) {
  const d = parseDate(str)
  if (!d || isNaN(d)) return ''
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
