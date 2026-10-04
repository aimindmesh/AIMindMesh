/**
 * Quiet hours in a given time zone. The server container runs in UTC while users live in
 * their own zone: hours are always read in the device's (or the configured) time zone.
 */

/** Local time of `date` in `timeZone` as a fractional hour (22.5 = 22:30); server time when no zone. */
export function hourIn(date: Date, timeZone?: string): number {
  if (!timeZone) return date.getHours() + date.getMinutes() / 60;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date);
  const value = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return value('hour') + value('minute') / 60;
}

/** "HH:MM" from an hour setting: 22, "7", "07:30". Null when it is not a valid time. */
export function toHHMM(value: unknown): string | null {
  let hours: number;
  let minutes = 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    hours = Math.floor(value);
    minutes = Math.round((value - hours) * 60);
  } else if (typeof value === 'string' && /^\d{1,2}(:\d{2})?$/.test(value.trim())) {
    const [h, m] = value.trim().split(':').map(Number);
    hours = h;
    minutes = m || 0;
  } else {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const toHour = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h + (m || 0) / 60;
};

/** Whether `hour` falls in [start, end); a start after the end crosses midnight (22:00-07:00). */
export function isWithinQuietHours(hour: number, start: string, end: string): boolean {
  const s = toHour(start);
  const e = toHour(end);
  return s > e ? hour >= s || hour < e : hour >= s && hour < e;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Node ids are upper case (NodeRegistry): device ids sent by the phones are normalized the same way. */
export function normalizeDeviceId(id: unknown): string {
  return typeof id === 'string' ? id.trim().toUpperCase() : '';
}
