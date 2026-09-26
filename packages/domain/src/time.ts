import type { QuietHours } from "./types";

function toMinutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** Minutes since local midnight for an instant, in the given IANA time zone. */
export function localMinutes(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** True when the instant falls inside the quiet-hours window (windows may cross midnight). */
export function isWithinQuietHours(iso: string, quiet: QuietHours | null, timeZone: string): boolean {
  if (!quiet) return false;
  const now = localMinutes(iso, timeZone);
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
