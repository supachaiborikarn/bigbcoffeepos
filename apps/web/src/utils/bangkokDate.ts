// The shop's day is the Thai calendar day; toISOString() is UTC and flips the date at 07:00.
export function bangkokDay(daysBack = 0) {
  return new Date(Date.now() - daysBack * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

/** Current Thai time as "HH:MM", for "yesterday up to this time" comparisons. */
export function bangkokClock() {
  return new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Today vs the same part of yesterday, in whole percent; null when yesterday had no sales to compare. */
export function percentChange(today: number, yesterday: number) {
  return yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : null;
}
