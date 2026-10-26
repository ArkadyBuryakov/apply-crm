import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function formatDateTime(iso: string | null | undefined) {
  return iso ? dateTime.format(new Date(iso)) : "";
}

export function formatDate(iso: string | null | undefined) {
  return iso ? dateOnly.format(new Date(iso)) : "";
}

/** Value for <input type="datetime-local"> from an ISO timestamp, in local time. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO timestamp from a datetime-local input value, or null when empty. */
export function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function humanize(key: string) {
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatMoney(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? "currency" : "decimal",
      currency: currency ?? undefined,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}
