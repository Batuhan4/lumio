export const formatCurrency = (value: number, currency = "USDC") =>
  `${currency} ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const formatPercent = (
  value: number,
  options?: Intl.NumberFormatOptions,
) =>
  `${(value * 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    ...options,
  })}%`;

export const formatRelativeDate = (value: string) => {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
