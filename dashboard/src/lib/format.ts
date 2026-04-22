const DEFAULT_LOCALE = "en-US";
const DEFAULT_TIME_ZONE = "UTC";

export type DateInput = string | number | Date;

function normalizeDateInput(value: DateInput): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00Z`);
    }

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
      return new Date(value.replace(" ", "T") + "Z");
    }
  }

  return new Date(value);
}

export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {}
): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    ...options,
    timeZone: DEFAULT_TIME_ZONE,
  }).format(normalizeDateInput(value));
}

export function formatDateTime(value: DateInput): string {
  return formatDate(value, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatShortDate(value: DateInput): string {
  return formatDate(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE).format(value);
}
