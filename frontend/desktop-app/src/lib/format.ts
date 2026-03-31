export function parseDate(value?: string) {
  if (!value) {
    return null;
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateTime(value?: string) {
  const parsed = parseDate(value);
  if (!parsed) {
    return value ?? "未提供";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function formatDateShort(value?: string) {
  const parsed = parseDate(value);
  if (!parsed) {
    return value ?? "未提供";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
  }).format(parsed);
}

export function formatMoney(value?: string | number) {
  if (value === undefined || value === null || value === "") {
    return "未提供";
  }

  const numberValue = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numberValue)) {
    return String(value);
  }

  return `￥${numberValue.toFixed(2)}`;
}

export function daysUntil(value?: string) {
  const parsed = parseDate(value);
  if (!parsed) {
    return null;
  }

  const diff = parsed.getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "DC";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
