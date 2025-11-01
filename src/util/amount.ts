const SCALE = 10_000_000n;

export const AMOUNT_SCALE = SCALE;

export const contractUnitsToNumber = (value: bigint): number => {
  return Number(value) / Number(SCALE);
};

export const parseAmountToContractUnits = (raw: string): bigint => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Enter an amount.");
  }

  const normalized = trimmed.startsWith(".") ? `0${trimmed}` : trimmed;
  if (!/^\d+(\.\d{0,7})?$/.test(normalized)) {
    throw new Error("Use at most 7 decimal places.");
  }

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  const whole = BigInt(wholePart) * SCALE;
  if (fractionalPart.length === 0) {
    return whole;
  }

  const fractional = fractionalPart
    .padEnd(7, "0")
    .slice(0, 7)
    .replace(/^0+$/, "0");

  return whole + BigInt(fractional);
};
