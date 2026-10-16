import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { decodeVin, looksLikeVin, type VinPattern } from '@autotech/engines';
import { DbService, applies } from '../db/db.service';

export interface VariantSummary {
  id: number;
  make: string;
  model: string;
  generation: string;
  platformCode: string | null;
  engineCode: string | null;
  fuel: string | null;
  displacementCc: number | null;
  transmissionCode: string | null;
  transmissionKind: string | null;
  powerKw: number;
  powerHp: number;
  drive: string | null;
  hv: string;
  hvVoltage: number | null;
  yearFrom: number;
  yearTo: number | null;
  label: string;
}

const VARIANT_SQL = `
  SELECT v.id, mk.name AS make, m.name AS model, g.name AS generation, g.platform_code AS "platformCode",
         e.code AS "engineCode", e.fuel, e.displacement_cc AS "displacementCc",
         t.code AS "transmissionCode", t.kind AS "transmissionKind",
         v.power_kw AS "powerKw", v.drive, v.hv, v.hv_voltage_nominal AS "hvVoltage",
         v.year_from AS "yearFrom", v.year_to AS "yearTo"
  FROM vehicle_variant v
  JOIN model_generation g ON g.id = v.generation_id
  JOIN model m ON m.id = g.model_id
  JOIN make mk ON mk.id = m.make_id
  LEFT JOIN engine e ON e.id = v.engine_id
  LEFT JOIN transmission t ON t.id = v.transmission_id`;

const ROMAN: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8', IX: '9', X: '10' };
const FUEL_ALIASES: Record<string, string> = {
  diesel: 'diesel gazole tdi dci hdi crdi bluehdi d',
  petrol: 'essence petrol tsi tfsi tce vti',
  hybrid_petrol: 'hybride hybrid hev essence',
  hybrid_diesel: 'hybride hybrid diesel',
  electric: 'electrique électrique ev bev',
};

function searchHaystack(v: VariantSummary): string {
  const gen = v.generation.replace(/\b(X|IX|VIII|VII|VI|V|IV|III|II|I)\b/g, m => `${m} ${ROMAN[m]}`);
  return [v.make, v.model, gen, v.platformCode, v.engineCode, v.transmissionCode, `${v.powerKw}kw`, `${v.powerHp}ch`,
    v.displacementCc ? (v.displacementCc / 1000).toFixed(1) : '', FUEL_ALIASES[v.fuel ?? ''] ?? v.fuel, v.yearFrom, v.yearTo, v.hv !== 'none' ? 'hybride' : '']
    .join(' ').toLowerCase();
}

function withLabel(r: Omit<VariantSummary, 'label' | 'powerHp'>): VariantSummary {
  const powerHp = Math.round(r.powerKw * 1.35962);
  const litres = r.displacementCc ? (r.displacementCc / 1000).toFixed(1) : '';
  const label = `${r.make} ${r.generation} ${litres} ${r.engineCode ?? ''} · ${r.transmissionCode ?? ''} · ${r.powerKw} kW (${powerHp} ch) · ${r.yearFrom}–${r.yearTo ?? ''}`
    .replace(/\s+/g, ' ').trim();
  return { ...r, powerHp, label };
}

@Injectable()
export class VehiclesService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async tree() {
    const rows = await this.db.query(`${VARIANT_SQL} ORDER BY mk.name, m.name, g.year_from, v.power_kw`);
    const makes = new Map<string, Map<string, Map<string, VariantSummary[]>>>();
    for (const r of rows) {
      const v = withLabel(r);
      if (!makes.has(v.make)) makes.set(v.make, new Map());
      const models = makes.get(v.make)!;
      if (!models.has(v.model)) models.set(v.model, new Map());
      const gens = models.get(v.model)!;
      if (!gens.has(v.generation)) gens.set(v.generation, []);
      gens.get(v.generation)!.push(v);
    }
    return [...makes].map(([make, models]) => ({
      make,
      models: [...models].map(([model, gens]) => ({
        model,
        generations: [...gens].map(([generation, variants]) => ({ generation, variants })),
      })),
    }));
  }

  async variant(id: number): Promise<VariantSummary> {
    const r = await this.db.one(`${VARIANT_SQL} WHERE v.id = $1`, [id]);
    if (!r) throw new NotFoundException('Véhicule introuvable');
    return withLabel(r);
  }

  async variantDetail(id: number) {
    const v = await this.variant(id);
    const fluids = await this.db.query(
      `SELECT system, capacity, unit, specification, viscosity FROM fluid_spec f WHERE ${applies('f')} ORDER BY system`, [id]);
    const counts = await this.db.one(`SELECT
        (SELECT count(*) FROM procedure p WHERE ${applies('p')})::int AS procedures,
        (SELECT count(*) FROM wiring_diagram d WHERE ${applies('d')})::int AS diagrams,
        (SELECT count(*) FROM labor_operation o WHERE ${applies('o')})::int AS "laborOperations",
        (SELECT count(*) FROM tsb t WHERE ${applies('t')})::int AS tsbs,
        (SELECT count(*) FROM dtc_vehicle_link l WHERE ${applies('l')})::int AS dtcs`, [id]);
    const source = await this.db.one(`SELECT name, origin FROM data_source ORDER BY created_at LIMIT 1`);
    return { ...v, fluids, counts, source };
  }

  private async patterns(wmi: string): Promise<VinPattern[]> {
    return this.db.query(
      `SELECT id, wmi, vds_regex AS "vdsRegex", model_year_from AS "modelYearFrom", model_year_to AS "modelYearTo",
              generation_id AS "generationId", variant_ids AS "variantIds", priority
       FROM vin_pattern WHERE wmi = $1`, [wmi]);
  }

  async decode(vinInput: string) {
    const first = decodeVin(vinInput);
    const result = first.valid ? decodeVin(vinInput, await this.patterns(first.wmi)) : first;
    const variantIds = [...new Set(result.matches.flatMap(m => m.variantIds))];
    const candidates = variantIds.length
      ? (await this.db.query(`${VARIANT_SQL} WHERE v.id = ANY($1) ORDER BY v.power_kw DESC`, [variantIds])).map(withLabel)
      : [];
    const make = result.valid
      ? await this.db.one<{ name: string }>(`SELECT name FROM make WHERE $1 = ANY(wmi_codes)`, [result.wmi])
      : null;
    if (result.valid && candidates.length) {
      await this.db.query(
        `INSERT INTO vin_decode_cache (vin, variant_id, candidates, provider, raw) VALUES ($1, $2, $3, 'internal', $4)
         ON CONFLICT (vin) DO UPDATE SET candidates = EXCLUDED.candidates, variant_id = EXCLUDED.variant_id, raw = EXCLUDED.raw, decoded_at = now()`,
        [result.vin, candidates.length === 1 ? candidates[0]!.id : null, variantIds, JSON.stringify({ wmi: result.wmi, years: result.modelYearCandidates })]);
    }
    return {
      vin: result.vin,
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      wmi: result.wmi,
      vds: result.vds,
      vis: result.vis,
      region: result.region,
      checkDigit: result.checkDigit,
      modelYearCandidates: result.modelYearCandidates,
      manufacturer: make?.name ?? null,
      candidates,
      needsDisambiguation: candidates.length > 1,
    };
  }

  /** Omnisearch: VIN, DTC code or free text over vehicles. */
  async search(q: string) {
    const query = q.trim();
    if (!query) return { kind: 'empty' as const, vehicles: [], dtcs: [] };
    if (looksLikeVin(query)) return { kind: 'vin' as const, decode: await this.decode(query), vehicles: [], dtcs: [] };

    const dtcs = /^[PBCU][0-9A-F]{4}$/i.test(query)
      ? await this.db.query(`SELECT id, code, description FROM dtc_definition WHERE code ILIKE $1 || '%' ORDER BY code LIMIT 10`, [query.toUpperCase()])
      : [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = (await this.db.query(`${VARIANT_SQL} ORDER BY mk.name, m.name, v.power_kw DESC`)).map(withLabel);
    const vehicles = rows.filter(v => {
      const words = searchHaystack(v).split(/[\s·/()-]+/).filter(Boolean);
      return terms.every(t => words.some(w => w.startsWith(t)));
    });
    return { kind: 'text' as const, vehicles: vehicles.slice(0, 20), dtcs };
  }
}
