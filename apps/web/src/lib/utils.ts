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

type Salary = { min: number | null; max: number | null; currency: string | null; period: string | null };

/** Working hours and months in a year, for annualizing hourly and monthly pay. */
const PER_YEAR: Record<string, number> = { year: 1, month: 12, hour: 8 * 260 };

export function formatSalaryRange(salary: Salary, factor = 1) {
  const scale = (n: number | null) => (n === null ? null : n * factor);
  return [formatMoney(scale(salary.min), salary.currency), formatMoney(scale(salary.max), salary.currency)]
    .filter(Boolean)
    .join(" – ");
}

/** "€40 – €50 / hour" plus, for non-yearly pay, the annualized range (8h days, 260 days a year). */
export function formatSalary(salary: Salary) {
  const range = formatSalaryRange(salary);
  if (!range) return null;
  const factor = salary.period ? PER_YEAR[salary.period] : undefined;
  return {
    range: salary.period ? `${range} / ${salary.period}` : range,
    yearly: factor && factor !== 1 ? `≈ ${formatSalaryRange(salary, factor)} / year` : null,
  };
}
