/**
 * VIN decoding per ISO 3779 / ISO 3780.
 *   positions 1-3  WMI  (World Manufacturer Identifier)
 *   positions 4-9  VDS  (Vehicle Descriptor Section; pos 9 = check digit in North America)
 *   positions 10-17 VIS (pos 10 = model year, pos 11 = plant, 12-17 = serial)
 */

const VIN_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/;

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// Model-year code at position 10 (30-year cycle, I O Q U Z and 0 are never used)
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

export type VinRegion =
  | 'africa' | 'asia' | 'europe' | 'north_america' | 'oceania' | 'south_america' | 'unknown';

export interface VinPattern {
  id: number;
  wmi: string;
  vdsRegex: string;       // applied to positions 4-9
  modelYearFrom: number | null;
  modelYearTo: number | null;
  generationId: number | null;
  variantIds: number[];
  priority: number;
}

export interface VinDecodeResult {
  vin: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  wmi: string;
  vds: string;
  vis: string;
  region: VinRegion;
  checkDigit: 'valid' | 'invalid' | 'not_applicable';
  modelYearCandidates: number[];
  matches: VinPattern[];
}

export function normalizeVin(input: string): string {
  return input.toUpperCase().replace(/[\s\-_.]/g, '');
}

export function vinRegion(vin: string): VinRegion {
  const c = vin[0];
  if (!c) return 'unknown';
  if ('ABCDEFGH'.includes(c)) return 'africa';
  if ('JKLMNPR'.includes(c)) return 'asia';
  if ('STUVWXYZ'.includes(c)) return 'europe';
  if ('12345'.includes(c)) return 'north_america';
  if ('67'.includes(c)) return 'oceania';
  if ('89'.includes(c)) return 'south_america';
  return 'unknown';
}

/** Expected check digit (position 9) per the North-American algorithm. */
export function computeCheckDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i]!;
    const value = /\d/.test(ch) ? Number(ch) : (TRANSLIT[ch] ?? 0);
    sum += value * WEIGHTS[i]!;
  }
  const rem = sum % 11;
  return rem === 10 ? 'X' : String(rem);
}

/**
 * Candidate model years for the code at position 10.
 * In North America position 7 disambiguates the cycle (digit → 1980-2009, letter → 2010-2039).
 * Elsewhere both cycles are returned and VIN patterns narrow them down.
 */
export function modelYearCandidates(vin: string, currentYear = new Date().getFullYear()): number[] {
  const idx = YEAR_CODES.indexOf(vin[9] ?? '');
  if (idx < 0) return [];
  const early = 1980 + idx;
  const late = early + 30;
  if (vinRegion(vin) === 'north_america') {
    return /\d/.test(vin[6] ?? '') ? [early] : [late].filter(y => y <= currentYear + 1);
  }
  return [early, late].filter(y => y <= currentYear + 1);
}

export function matchVinPatterns(vin: string, years: number[], patterns: VinPattern[]): VinPattern[] {
  const wmi = vin.slice(0, 3);
  const vds = vin.slice(3, 9);
  return patterns
    .filter(p => p.wmi === wmi)
    .filter(p => {
      try { return new RegExp(p.vdsRegex).test(vds); } catch { return false; }
    })
    .filter(p => {
      if (years.length === 0) return true;
      return years.some(y => (p.modelYearFrom == null || y >= p.modelYearFrom) && (p.modelYearTo == null || y <= p.modelYearTo));
    })
    .sort((a, b) => b.priority - a.priority);
}

export function decodeVin(input: string, patterns: VinPattern[] = [], currentYear?: number): VinDecodeResult {
  const vin = normalizeVin(input);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (vin.length !== 17) errors.push(`Un VIN contient 17 caractères (reçu ${vin.length}).`);
  if (/[IOQ]/.test(vin)) errors.push('Les lettres I, O et Q sont interdites dans un VIN (ISO 3779).');
  else if (vin.length === 17 && !VIN_CHARS.test(vin)) errors.push('Caractères invalides dans le VIN.');

  const base = {
    vin, wmi: vin.slice(0, 3), vds: vin.slice(3, 9), vis: vin.slice(9, 17), region: vinRegion(vin),
  };
  if (errors.length) {
    return { ...base, valid: false, errors, warnings, checkDigit: 'not_applicable', modelYearCandidates: [], matches: [] };
  }

  let checkDigit: VinDecodeResult['checkDigit'] = 'not_applicable';
  const pos9 = vin[8]!;
  const expected = computeCheckDigit(vin);
  if (base.region === 'north_america') {
    checkDigit = pos9 === expected ? 'valid' : 'invalid';
    if (checkDigit === 'invalid') errors.push(`Chiffre de contrôle invalide (attendu ${expected}, reçu ${pos9}).`);
  } else if (/[0-9X]/.test(pos9) && pos9 === expected) {
    checkDigit = 'valid';
  } else {
    warnings.push('Chiffre de contrôle non utilisé (normal pour la plupart des constructeurs européens).');
  }

  const years = modelYearCandidates(vin, currentYear);
  const matches = matchVinPatterns(vin, years, patterns);
  if (patterns.length && matches.length === 0) warnings.push('Aucun modèle correspondant dans la base : sélection manuelle nécessaire.');

  return { ...base, valid: errors.length === 0, errors, warnings, checkDigit, modelYearCandidates: years, matches };
}

/** True when a free-text query looks like a VIN attempt (single token, 11+ alnum chars, contains a digit). */
export function looksLikeVin(query: string): boolean {
  const q = query.trim();
  if (/\s/.test(q)) return false;
  const n = normalizeVin(q);
  return n.length >= 11 && /\d/.test(n) && /[A-Z]/.test(n);
}
