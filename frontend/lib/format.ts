/**
 * Number formatting.
 *
 * Every locale-sensitive format in the product goes through here with an
 * explicit "en-US" locale: the default locale groups Indian-English digits as
 * 1,36,696, which reads as a typo next to the rest of the interface.
 */

const LOCALE = "en-US";

/** Thousands-separated integer. */
export function count(value: number): string {
  return Math.round(value).toLocaleString(LOCALE);
}

/** Large populations, shortened: 1.2M, 340k, 8,400. */
export function people(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return count(value);
}

/** A livability score, 0 to 1, three decimals. */
export function score(value: number): string {
  return value.toLocaleString(LOCALE, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

/**
 * Population-weighted impact: people multiplied by the score they gained.
 *
 * The raw figure runs from a few hundred to the high thousands, so it is
 * shortened the same way populations are and always carries its sign — a
 * change that costs people is as real a result as one that helps them.
 */
export function impact(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${people(Math.abs(value))}`;
}

/** A signed change, with the sign always shown. */
export function delta(value: number, digits = 1): string {
  const fixed = Math.abs(value).toLocaleString(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // Zero has no sign, and at zero digits there is no decimal point either.
  if (Math.abs(value) < 10 ** -digits / 2) {
    return digits > 0 ? `0.${"0".repeat(digits)}` : "0";
  }
  return `${value > 0 ? "+" : "-"}${fixed}`;
}

export function percent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toLocaleString(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}
