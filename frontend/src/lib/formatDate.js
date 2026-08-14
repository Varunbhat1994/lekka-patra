// Presentational date formatter — DD/MM/YYYY for all user-facing displays.
// Never call this for API/DB values; internal ISO/timestamps must stay untouched.

export function fmtDate(input) {
  if (input === null || input === undefined || input === "") return "";
  const s = String(input);

  // ISO date-only (YYYY-MM-DD) — split manually to avoid TZ shifts.
  const isoDateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const [, y, m, d] = isoDateOnly;
    return `${d}/${m}/${y}`;
  }

  const dt = new Date(s);
  if (isNaN(dt.getTime())) return s;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function fmtDateTime(input) {
  if (!input) return "";
  const dt = new Date(input);
  if (isNaN(dt.getTime())) return String(input);
  return dt.toLocaleString("en-GB");
}
