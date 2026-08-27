import { parseIsoCalendarDate } from "@/lib/validation";

export const ACCOUNT_MIN_AGE = 13;
export const ACCOUNT_MAX_AGE = 100;

function formatUtcDate(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function shiftUtcYearsClamped(value: Date, years: number) {
  const year = value.getUTCFullYear() + years;
  const month = value.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(value.getUTCDate(), lastDay)));
}

export function calculateAge(birthDate: Date, today = new Date()) {
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  if (today.getUTCMonth() < birthDate.getUTCMonth() || (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() < birthDate.getUTCDate())) age -= 1;
  return age;
}

export function isEligibleBirthDate(value: string, today = new Date()) {
  const birthDate = parseIsoCalendarDate(value);
  if (!birthDate) return false;
  const age = calculateAge(birthDate, today);
  return age >= ACCOUNT_MIN_AGE && age <= ACCOUNT_MAX_AGE;
}

export function getBirthDateInputBounds(today = new Date()) {
  const maximum = shiftUtcYearsClamped(today, -ACCOUNT_MIN_AGE);
  const minimum = shiftUtcYearsClamped(today, -(ACCOUNT_MAX_AGE + 1));
  minimum.setUTCDate(minimum.getUTCDate() + 1);
  return { min: formatUtcDate(minimum), max: formatUtcDate(maximum) };
}
