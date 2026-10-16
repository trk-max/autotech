export const pct = (p: number) => `${Math.round(p * 100)} %`;
export const hours = (h: number) => `${h.toFixed(2).replace('.', ',')} h`;
export const km = (n: number) => `${n.toLocaleString('fr-FR')} km`;
export const num = (n: number, digits = 2) => n.toLocaleString('fr-FR', { maximumFractionDigits: digits });

export function specRange(min: number | null, max: number | null, unit: string): string {
  if (min != null && max != null) return `${num(min)} – ${num(max)} ${unit}`;
  if (min != null) return `≥ ${num(min)} ${unit}`;
  if (max != null) return `≤ ${num(max)} ${unit}`;
  return unit;
}

export const MEASURE_LABEL: Record<string, string> = {
  voltage_dc: 'Tension continue', voltage_ac: 'Tension alternative', resistance: 'Résistance', current: 'Intensité',
  frequency: 'Fréquence', duty_cycle: 'Rapport cyclique', continuity: 'Continuité', waveform: 'Oscillogramme', visual: 'Contrôle visuel',
};

export const COLOUR_NAMES: Record<string, string> = {
  sw: 'noir', rt: 'rouge', br: 'marron', ws: 'blanc', gn: 'vert', bl: 'bleu', ge: 'jaune', or: 'orange', gr: 'gris', li: 'violet', rs: 'rose',
};
export const colourName = (p: string, s?: string | null) => `${COLOUR_NAMES[p] ?? p}${s ? '/' + (COLOUR_NAMES[s] ?? s) : ''}`;

export const SIGNAL_LABEL: Record<string, string> = {
  power: 'Alimentation', ground: 'Masse', signal: 'Signal', can_h: 'CAN-H', can_l: 'CAN-L', lin: 'LIN', shield: 'Blindage', hv_pos: 'HT +', hv_neg: 'HT −',
};

export function vehicleLines(v: { make: string; generation: string; displacementCc: number | null; engineCode: string | null; transmissionCode: string | null; powerKw: number; powerHp: number; yearFrom: number; yearTo: number | null }) {
  return {
    title: `${v.make} ${v.generation}`,
    engine: [v.displacementCc ? (v.displacementCc / 1000).toFixed(1) : null, v.engineCode].filter(Boolean).join(' '),
    gearbox: v.transmissionCode ?? '',
    power: `${v.powerKw} kW / ${v.powerHp} ch`,
    years: `${v.yearFrom}–${v.yearTo ?? 'auj.'}`,
  };
}
