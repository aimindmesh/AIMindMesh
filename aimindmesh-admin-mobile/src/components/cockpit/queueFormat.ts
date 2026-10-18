/** Time of a queue event (hh:mm:ss). */
export function formatDateTime(ts: number | string) {
  if (!ts) return '--';
  const date = new Date(Number(ts));
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Duration between two queue timestamps (ms below a second, else seconds). */
export function formatElapsed(start: number, end: number) {
  if (!start || !end) return '--';
  const diff = Number(end) - Number(start);
  if (diff < 1000) return `${diff}ms`;
  const sec = (diff / 1000).toFixed(1);
  return `${sec}s`;
}
