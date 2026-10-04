/** YYYY-MM-DD as local noon (a date, not an instant) */
export function parseDueDate(value: unknown): number | undefined {
    if (typeof value !== 'string') return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return undefined;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    return date.getMonth() === Number(match[2]) - 1 ? date.getTime() : undefined;
}
