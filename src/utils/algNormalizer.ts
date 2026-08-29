import { Alg } from 'cubing/alg';

/**
 * Normalizes algorithm strings from external datasets to standard cubing.js-compliant Alg notation.
 * Fixes:
 * - Inverted modifier order like "U'2" -> "U2'"
 * - Simultaneous layer tokens like "D+U'" -> "D U'"
 * - Excessive brackets and spaces
 */
export function normalizeAlgString(raw: string): string {
  if (!raw) return '';

  let cleaned = raw
    // Replace simultaneous notation like D+U' or U'+D with space
    .replace(/\+/g, ' ')
    // Fix U'2 -> U2', R'2 -> R2', etc.
    .replace(/([RUFBLDrufbdlMSExyz])'2/g, "$12'")
    .replace(/([RUFBLDrufbdlMSExyz])2'/g, "$12'")
    // Remove unnecessary grouping brackets if any cause parser hiccups
    .replace(/[()]/g, ' ')
    // Collapse multiple whitespaces
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

export function parseAlgSafely(raw: string): Alg {
  const normalized = normalizeAlgString(raw);
  try {
    return new Alg(normalized);
  } catch (err) {
    console.warn(`Failed to parse alg '${raw}' (normalized: '${normalized}'):`, err);
    return new Alg('');
  }
}
