/**
 * DEMO SEED — synthetic data for development and demos only.
 * Every row points to the data_source "Données de démonstration" (origin = test_fixture).
 * Values are plausible but NOT manufacturer data: never use them for a real repair.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';
import { DATABASE_URL, STORAGE_DIR } from './env';
import { renderDiagram, type SvgComponent, type SvgNode, type SvgWire } from './svg';

export const DEMO_ORG_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000002';

type Row = Record<string, any>;

export async function seed(client: Client): Promise<void> {
  const one = async (sql: string, params: unknown[] = []): Promise<Row> => (await client.query(sql, params)).rows[0];
  const id = async (sql: string, params: unknown[] = []): Promise<number> => Number((await one(sql, params)).id);

  await client.query('BEGIN');
  try {
    const existing = await one(`SELECT count(*)::int AS n FROM make`);
    if (existing.n > 0) {
      console.log('Seed skipped: data already present (use pnpm db:reset to start over).');
      await client.query('ROLLBACK');
      return;
    }

    // ---------- provenance ----------
    const SRC = (await one(
      `INSERT INTO data_source (name, origin, redistribution_allowed, territory)
       VALUES ('Données de démonstration (synthétiques)', 'test_fixture', true, '{TN,EU}') RETURNING id`)).id as string;

    // ---------- tenancy ----------
    await client.query(`INSERT INTO organization (id, name, plan) VALUES ($1, 'Atelier démo', 'full')`, [DEMO_ORG_ID]);
    await client.query(`INSERT INTO app_user (id, org_id, role) VALUES ($1, $2, 'technician')`, [DEMO_USER_ID, DEMO_ORG_ID]);

    // ---------- applicability helper ----------
    const groups = new Map<string, number>();
    const ag = async (variantIds: number[], conditions: Row = {}): Promise<number> => {
      const sig = crypto.createHash('sha256').update(JSON.stringify([[...variantIds].sort((a, b) => a - b), conditions])).digest('hex');
      if (groups.has(sig)) return groups.get(sig)!;
      const g = await id(`INSERT INTO applicability_group (signature, conditions) VALUES ($1, $2) RETURNING id`, [sig, conditions]);
      for (const v of variantIds) await client.query(`INSERT INTO applicability_member VALUES ($1, $2)`, [g, v]);
      groups.set(sig, g);
      return g;
    };

    // ---------- vehicle matrix ----------
    const vw = await id(`INSERT INTO make (name, wmi_codes) VALUES ('Volkswagen', '{WVW,WV1,WV2}') RETURNING id`);
    const renault = await id(`INSERT INTO make (name, wmi_codes) VALUES ('Renault', '{VF1}') RETURNING id`);
    const toyota = await id(`INSERT INTO make (name, wmi_codes) VALUES ('Toyota', '{VNK,JTD,SB1}') RETURNING id`);

    const golf = await id(`INSERT INTO model (make_id, name) VALUES ($1, 'Golf') RETURNING id`, [vw]);
    const clio = await id(`INSERT INTO model (make_id, name) VALUES ($1, 'Clio') RETURNING id`, [renault]);
    const yaris = await id(`INSERT INTO model (make_id, name) VALUES ($1, 'Yaris') RETURNING id`, [toyota]);

    const golf7 = await id(`INSERT INTO model_generation (model_id, name, platform_code, year_from, year_to, body_types)
      VALUES ($1, 'Golf VII', 'MQB / 5G', 2012, 2020, '{hatchback,estate}') RETURNING id`, [golf]);
    const clio4 = await id(`INSERT INTO model_generation (model_id, name, platform_code, year_from, year_to, body_types)
      VALUES ($1, 'Clio IV', 'B98', 2012, 2019, '{hatchback,estate}') RETURNING id`, [clio]);
    const yaris3 = await id(`INSERT INTO model_generation (model_id, name, platform_code, year_from, year_to, body_types)
      VALUES ($1, 'Yaris III Hybrid', 'XP130', 2012, 2020, '{hatchback}') RETURNING id`, [yaris]);

    const eCRLB = await id(`INSERT INTO engine (make_id, code, fuel, displacement_cc, cylinders, aspiration, timing_drive, max_power_kw)
      VALUES ($1, 'CRLB', 'diesel', 1968, 4, 'turbo', 'belt', 110) RETURNING id`, [vw]);
    const eCLHA = await id(`INSERT INTO engine (make_id, code, fuel, displacement_cc, cylinders, aspiration, timing_drive, max_power_kw)
      VALUES ($1, 'CLHA', 'diesel', 1598, 4, 'turbo', 'belt', 77) RETURNING id`, [vw]);
    const eK9K = await id(`INSERT INTO engine (make_id, code, fuel, displacement_cc, cylinders, aspiration, timing_drive, max_power_kw)
      VALUES ($1, 'K9K 608', 'diesel', 1461, 4, 'turbo', 'belt', 66) RETURNING id`, [renault]);
    const e1NZ = await id(`INSERT INTO engine (make_id, code, fuel, displacement_cc, cylinders, aspiration, timing_drive, max_power_kw)
      VALUES ($1, '1NZ-FXE', 'hybrid_petrol', 1497, 4, 'na', 'chain', 54) RETURNING id`, [toyota]);

    const tDQ250 = await id(`INSERT INTO transmission (code, kind, gears) VALUES ('DQ250', 'dct', 6) RETURNING id`);
    const tMQ200 = await id(`INSERT INTO transmission (code, kind, gears) VALUES ('MQ200', 'manual', 5) RETURNING id`);
    const tJR5 = await id(`INSERT INTO transmission (code, kind, gears) VALUES ('JR5', 'manual', 5) RETURNING id`);
    const tECVT = await id(`INSERT INTO transmission (code, kind, gears) VALUES ('P510 e-CVT', 'cvt', NULL) RETURNING id`);

    const vGolf20 = await id(`INSERT INTO vehicle_variant (generation_id, engine_id, transmission_id, power_kw, drive, year_from, year_to, markets)
      VALUES ($1, $2, $3, 110, 'fwd', 2013, 2020, '{EU,TN}') RETURNING id`, [golf7, eCRLB, tDQ250]);
    const vGolf16 = await id(`INSERT INTO vehicle_variant (generation_id, engine_id, transmission_id, power_kw, drive, year_from, year_to, markets)
      VALUES ($1, $2, $3, 77, 'fwd', 2013, 2020, '{EU,TN}') RETURNING id`, [golf7, eCLHA, tMQ200]);
    const vClio = await id(`INSERT INTO vehicle_variant (generation_id, engine_id, transmission_id, power_kw, drive, year_from, year_to, markets)
      VALUES ($1, $2, $3, 66, 'fwd', 2012, 2019, '{EU,TN}') RETURNING id`, [clio4, eK9K, tJR5]);
    const vYaris = await id(`INSERT INTO vehicle_variant (generation_id, engine_id, transmission_id, power_kw, drive, hv, hv_voltage_nominal, year_from, year_to, markets)
      VALUES ($1, $2, $3, 74, 'fwd', 'hev', 144, 2012, 2020, '{EU,TN}') RETURNING id`, [yaris3, e1NZ, tECVT]);

    await client.query(`INSERT INTO vin_pattern (wmi, vds_regex, model_year_from, model_year_to, generation_id, variant_ids, priority)
      VALUES ('WVW', '^ZZZAU', 2013, 2020, $1, $2, 10)`, [golf7, [vGolf20, vGolf16]]);
    await client.query(`INSERT INTO vin_pattern (wmi, vds_regex, model_year_from, model_year_to, generation_id, variant_ids, priority)
      VALUES ('VF1', '^5R', NULL, NULL, $1, $2, 10)`, [clio4, [vClio]]);
    await client.query(`INSERT INTO vin_pattern (wmi, vds_regex, model_year_from, model_year_to, generation_id, variant_ids, priority)
      VALUES ('VNK', '^K', 2012, 2020, $1, $2, 10)`, [yaris3, [vYaris]]);

    const gGolf = await ag([vGolf20, vGolf16]);
    const gGolf20 = await ag([vGolf20]);
    const gGolf16 = await ag([vGolf16]);
    const gClio = await ag([vClio]);
    const gYaris = await ag([vYaris]);

    // ---------- component types ----------
    const ct: Record<string, number> = {};
    for (const [code, name, system] of [
      ['ECM', 'Calculateur moteur', 'engine.management'], ['TCM', 'Calculateur de boîte', 'transmission.control'],
      ['GATEWAY', 'Passerelle de diagnostic', 'electrical.network'], ['ABS', 'Calculateur ABS/ESP', 'chassis.brakes'],
      ['CLUSTER', "Combiné d'instruments", 'body.instruments'], ['CKP_SENSOR', 'Capteur de régime moteur', 'engine.management.sensors'],
      ['BATTERY_12V', 'Batterie 12 V', 'electrical.charging'], ['ALTERNATOR', 'Alternateur', 'electrical.charging'],
      ['RAIL_PRESSURE_SENSOR', 'Capteur de pression rampe', 'engine.fuel.injection'], ['FUEL_FILTER', 'Filtre à gazole', 'engine.fuel.supply'],
      ['HP_PUMP', 'Pompe haute pression', 'engine.fuel.injection'], ['IMV', 'Régulateur de débit (IMV)', 'engine.fuel.injection'],
      ['HV_BATTERY', 'Batterie haute tension', 'hybrid.battery'], ['BATTERY_ECU', 'Calculateur batterie HT', 'hybrid.battery'],
      ['HV_ECU', 'Calculateur gestion hybride', 'hybrid.control'], ['INVERTER', 'Onduleur / convertisseur', 'hybrid.power'],
      ['HV_FAN', 'Ventilateur batterie HT', 'hybrid.battery.cooling'], ['AC_COMPRESSOR', 'Compresseur de clim. électrique', 'hvac.compressor'],
    ] as const) {
      ct[code] = await id(`INSERT INTO component_type (code, name, system) VALUES ($1, $2, $3) RETURNING id`, [code, name, system]);
    }
    const comp = async (type: string, ref: string, name: string, g: number, isEcu = false, location: string | null = null) =>
      id(`INSERT INTO component (type_id, oem_ref, name, is_ecu, location_text, applicability_group_id, source_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [ct[type], ref, name, isEcu, location, g, SRC]);

    // ===================================================================
    // GOLF VII — engine management power supply, CAN and CKP sensor
    // ===================================================================
    const cECM = await comp('ECM', 'J623', 'Calculateur moteur', gGolf, true, "Compartiment moteur, côté gauche, sous le boîtier de filtre à air");
    const cTCM = await comp('TCM', 'J743', 'Mécatronique DSG', gGolf20, true, 'Sur la boîte DQ250, côté gauche');
    const cGW = await comp('GATEWAY', 'J533', 'Interface de diagnostic du bus de données', gGolf, true, 'Sous le tableau de bord, à gauche de la colonne de direction');
    const cABS = await comp('ABS', 'J104', 'Calculateur ABS/ESP', gGolf, true, 'Compartiment moteur, côté gauche, sur le bloc hydraulique');
    const cCluster = await comp('CLUSTER', 'J285', "Combiné d'instruments", gGolf, true, 'Tableau de bord');
    const cG28 = await comp('CKP_SENSOR', 'G28', 'Transmetteur de régime moteur', gGolf, false, 'Bloc moteur, côté boîte, au-dessus du démarreur');
    const cBatt = await comp('BATTERY_12V', 'A', 'Batterie', gGolf, false, 'Compartiment moteur, côté gauche');
    const cAlt = await comp('ALTERNATOR', 'C', 'Alternateur', gGolf, false, 'Face avant moteur, côté droit');

    const busPT = await id(`INSERT INTO network_bus (name, protocol, bitrate_kbps, applicability_group_id)
      VALUES ('CAN Propulsion', 'can_hs', 500, $1) RETURNING id`, [gGolf]);
    const busIC = await id(`INSERT INTO network_bus (name, protocol, bitrate_kbps, applicability_group_id)
      VALUES ('CAN Combiné', 'can_hs', 500, $1) RETURNING id`, [gGolf]);
    for (const [bus, c, gw, addr] of [
      [busPT, cECM, false, '0x01'], [busPT, cTCM, false, '0x02'], [busPT, cABS, false, '0x03'], [busPT, cGW, true, '0x19'],
      [busIC, cGW, true, '0x19'], [busIC, cCluster, false, '0x17'],
    ] as const) {
      await client.query(`INSERT INTO bus_node VALUES ($1, $2, $3, $4)`, [bus, c, gw, addr]);
    }

    const conn = async (componentId: number | null, code: string, cavities: number, colour: string, location: string) =>
      id(`INSERT INTO connector (component_id, code, cavity_count, housing_colour, location_text) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [componentId, code, cavities, colour, location]);
    const kECM = await conn(cECM, 'T94', 94, 'noir', 'Sur le calculateur moteur');
    const kTCM = await conn(cTCM, 'T25', 25, 'noir', 'Sur la mécatronique');
    const kGW = await conn(cGW, 'T20', 20, 'noir', 'Sur la passerelle J533');
    const kABS = await conn(cABS, 'T46', 46, 'noir', "Sur le calculateur ABS");
    const kG28 = await conn(cG28, 'T3', 3, 'gris', 'Sur le capteur G28');
    const kBatt = await conn(cBatt, 'Bornes', 2, '-', 'Bornes batterie');

    const node = async (kind: string, connectorId: number | null, pin: string | null, name: string, location: string | null = null) =>
      id(`INSERT INTO electrical_node (kind, connector_id, pin_label, name, location_text) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [kind, connectorId, pin, name, location]);

    const nBattPos = await node('pin', kBatt, '+', 'Batterie +');
    const nBattNeg = await node('pin', kBatt, '-', 'Batterie −');
    const nGndBatt = await node('ground', null, null, 'Masse batterie-carrosserie', 'Longeron gauche, près de la batterie');
    const nSB15 = await node('fuse', null, null, 'Fusible SB15 (15 A)', 'Porte-fusibles sur batterie');
    const nSB20 = await node('fuse', null, null, 'Fusible SB20 (30 A)', 'Porte-fusibles sur batterie');
    const nGnd12 = await node('ground', null, null, 'Point de masse 12', 'Compartiment moteur, sur la culasse côté boîte');
    const nGS = await node('splice', null, null, 'Raccord de masse 1 (faisceau moteur)');
    const nSH = await node('splice', null, null, 'Raccord CAN-H propulsion');
    const nSL = await node('splice', null, null, 'Raccord CAN-L propulsion');
    const ecm = {
      bplus: await node('pin', kECM, '5', 'J623 T94/5 — +30 alimentation'),
      gnd: await node('pin', kECM, '1', 'J623 T94/1 — masse'),
      canh: await node('pin', kECM, '87', 'J623 T94/87 — CAN-H'),
      canl: await node('pin', kECM, '88', 'J623 T94/88 — CAN-L'),
      ref5: await node('pin', kECM, '36', 'J623 T94/36 — alimentation 5 V G28'),
      sig: await node('pin', kECM, '37', 'J623 T94/37 — signal G28'),
      sgnd: await node('pin', kECM, '38', 'J623 T94/38 — masse capteur G28'),
    };
    const tcm = {
      bplus: await node('pin', kTCM, '1', 'J743 T25/1 — +30 alimentation'),
      gnd: await node('pin', kTCM, '2', 'J743 T25/2 — masse'),
      canh: await node('pin', kTCM, '10', 'J743 T25/10 — CAN-H'),
      canl: await node('pin', kTCM, '11', 'J743 T25/11 — CAN-L'),
    };
    const gw = { canh: await node('pin', kGW, '6', 'J533 T20/6 — CAN-H propulsion'), canl: await node('pin', kGW, '16', 'J533 T20/16 — CAN-L propulsion') };
    const abs = { canh: await node('pin', kABS, '26', 'J104 T46/26 — CAN-H'), canl: await node('pin', kABS, '14', 'J104 T46/14 — CAN-L') };
    const g28 = {
      ref5: await node('pin', kG28, '1', 'G28 T3/1 — alimentation 5 V'),
      sig: await node('pin', kG28, '2', 'G28 T3/2 — signal'),
      gnd: await node('pin', kG28, '3', 'G28 T3/3 — masse capteur'),
    };

    // wires + drawing coordinates
    const svgWires: SvgWire[] = [];
    const wire = async (from: number, to: number, cp: string, cs: string | null, mm2: number, signal: string, label: string, points: [number, number][]) => {
      const wid = await id(`INSERT INTO wire (from_node_id, to_node_id, colour_primary, colour_stripe, cross_section_mm2, signal, circuit_label, applicability_group_id, source_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [from, to, cp, cs, mm2, signal, label, gGolf, SRC]);
      svgWires.push({ entityId: wid, points, colourPrimary: cp, colourStripe: cs, label, signal });
      return wid;
    };
    await wire(nBattPos, nSB15, 'rt', null, 6, 'power', '30', [[180, 95], [300, 95]]);
    await wire(nBattPos, nSB20, 'rt', null, 6, 'power', '30', [[180, 95], [240, 95], [240, 175], [300, 175]]);
    await wire(nBattNeg, nGndBatt, 'br', null, 25, 'ground', '31', [[110, 130], [110, 200]]);
    await wire(nSB15, ecm.bplus, 'rt', 'ws', 1.5, 'power', '30a', [[300, 95], [520, 95]]);
    await wire(nSB20, tcm.bplus, 'rt', 'gn', 2.5, 'power', '30b', [[300, 175], [400, 175], [400, 505], [520, 505]]);
    const wEcmGnd = await wire(ecm.gnd, nGS, 'br', null, 2.5, 'ground', '31', [[520, 300], [470, 300], [470, 690], [440, 690]]);
    await wire(tcm.gnd, nGS, 'br', null, 2.5, 'ground', '31', [[520, 640], [440, 640], [440, 690]]);
    await wire(nGS, nGnd12, 'br', null, 4, 'ground', '31', [[440, 690], [380, 690], [380, 720]]);
    await wire(ecm.canh, nSH, 'or', 'sw', 0.35, 'can_h', 'CAN-H', [[740, 250], [880, 250], [880, 350]]);
    await wire(tcm.canh, nSH, 'or', 'sw', 0.35, 'can_h', 'CAN-H', [[740, 560], [880, 560], [880, 350]]);
    await wire(nSH, gw.canh, 'or', 'sw', 0.35, 'can_h', 'CAN-H', [[880, 350], [1050, 350]]);
    await wire(abs.canh, nSH, 'or', 'sw', 0.35, 'can_h', 'CAN-H', [[1050, 600], [960, 600], [960, 350], [880, 350]]);
    await wire(ecm.canl, nSL, 'or', 'br', 0.35, 'can_l', 'CAN-L', [[740, 280], [910, 280], [910, 380]]);
    await wire(tcm.canl, nSL, 'or', 'br', 0.35, 'can_l', 'CAN-L', [[740, 590], [910, 590], [910, 380]]);
    await wire(nSL, gw.canl, 'or', 'br', 0.35, 'can_l', 'CAN-L', [[910, 380], [1050, 380]]);
    await wire(abs.canl, nSL, 'or', 'br', 0.35, 'can_l', 'CAN-L', [[1050, 630], [990, 630], [990, 380], [910, 380]]);
    await wire(ecm.ref5, g28.ref5, 'bl', 'ws', 0.35, 'power', '5V ref', [[740, 95], [1100, 95]]);
    const wG28Sig = await wire(ecm.sig, g28.sig, 'gn', null, 0.35, 'signal', 'Signal régime', [[740, 125], [1100, 125]]);
    await wire(ecm.sgnd, g28.gnd, 'br', 'ws', 0.35, 'ground', 'Masse capteur', [[740, 155], [1100, 155]]);

    const svgComponents: SvgComponent[] = [
      { entityId: cBatt, ref: 'A', label: 'Batterie 12 V', x: 40, y: 60, w: 140, h: 70 },
      { entityId: cECM, ref: 'J623', label: 'Calculateur moteur', x: 520, y: 60, w: 220, h: 300, ecu: true },
      { entityId: cTCM, ref: 'J743', label: 'Mécatronique DSG', x: 520, y: 470, w: 220, h: 200, ecu: true },
      { entityId: cGW, ref: 'J533', label: 'Passerelle diagnostic', x: 1050, y: 300, w: 220, h: 160, ecu: true },
      { entityId: cABS, ref: 'J104', label: 'Calculateur ABS/ESP', x: 1050, y: 560, w: 220, h: 120, ecu: true },
      { entityId: cG28, ref: 'G28', label: 'Capteur régime', x: 1100, y: 60, w: 180, h: 120 },
    ];
    const svgNodes: SvgNode[] = [
      { entityId: nBattPos, kind: 'pin', label: '+', x: 180, y: 95 },
      { entityId: nBattNeg, kind: 'pin', label: '−', x: 110, y: 130 },
      { entityId: nGndBatt, kind: 'ground', label: 'Masse batterie', x: 110, y: 200 },
      { entityId: nSB15, kind: 'fuse', label: 'SB15 15A', x: 300, y: 95 },
      { entityId: nSB20, kind: 'fuse', label: 'SB20 30A', x: 300, y: 175 },
      { entityId: nGS, kind: 'splice', label: 'Raccord masse 1', x: 440, y: 690 },
      { entityId: nGnd12, kind: 'ground', label: 'Masse 12', x: 380, y: 720 },
      { entityId: nSH, kind: 'splice', label: 'CAN-H', x: 880, y: 350, anchor: 'left' },
      { entityId: nSL, kind: 'splice', label: 'CAN-L', x: 910, y: 380 },
      { entityId: ecm.bplus, kind: 'pin', label: '5', x: 520, y: 95, anchor: 'left' },
      { entityId: ecm.gnd, kind: 'pin', label: '1', x: 520, y: 300, anchor: 'left' },
      { entityId: ecm.canh, kind: 'pin', label: '87', x: 740, y: 250 },
      { entityId: ecm.canl, kind: 'pin', label: '88', x: 740, y: 280 },
      { entityId: ecm.ref5, kind: 'pin', label: '36', x: 740, y: 95 },
      { entityId: ecm.sig, kind: 'pin', label: '37', x: 740, y: 125 },
      { entityId: ecm.sgnd, kind: 'pin', label: '38', x: 740, y: 155 },
      { entityId: tcm.bplus, kind: 'pin', label: '1', x: 520, y: 505, anchor: 'left' },
      { entityId: tcm.gnd, kind: 'pin', label: '2', x: 520, y: 640, anchor: 'left' },
      { entityId: tcm.canh, kind: 'pin', label: '10', x: 740, y: 560 },
      { entityId: tcm.canl, kind: 'pin', label: '11', x: 740, y: 590 },
      { entityId: gw.canh, kind: 'pin', label: '6', x: 1050, y: 350, anchor: 'left' },
      { entityId: gw.canl, kind: 'pin', label: '16', x: 1050, y: 380, anchor: 'left' },
      { entityId: abs.canh, kind: 'pin', label: '26', x: 1050, y: 600, anchor: 'left' },
      { entityId: abs.canl, kind: 'pin', label: '14', x: 1050, y: 630, anchor: 'left' },
      { entityId: g28.ref5, kind: 'pin', label: '1', x: 1100, y: 95, anchor: 'left' },
      { entityId: g28.sig, kind: 'pin', label: '2', x: 1100, y: 125, anchor: 'left' },
      { entityId: g28.gnd, kind: 'pin', label: '3', x: 1100, y: 155, anchor: 'left' },
    ];

    // diagram row first (id needed inside the SVG), then asset + element map
    const diagramTitle = 'Gestion moteur — alimentation, CAN propulsion et capteur de régime G28';
    const dGolf = await id(`INSERT INTO wiring_diagram (title, system, render_mode, asset_key, asset_sha256, applicability_group_id, source_id)
      VALUES ($1, 'engine.management', 'interactive_svg', 'pending', repeat('0', 64), $2, $3) RETURNING id`, [diagramTitle, gGolf, SRC]);
    const { svg, elements } = renderDiagram({ diagramId: dGolf, title: diagramTitle, width: 1340, height: 780, components: svgComponents, nodes: svgNodes, wires: svgWires });
    const sha = crypto.createHash('sha256').update(svg).digest('hex');
    const assetKey = `diagrams/${sha}.svg`;
    fs.mkdirSync(path.join(STORAGE_DIR, 'diagrams'), { recursive: true });
    fs.writeFileSync(path.join(STORAGE_DIR, assetKey), svg);
    await client.query(`UPDATE wiring_diagram SET asset_key = $1, asset_sha256 = $2 WHERE id = $3`, [assetKey, sha, dGolf]);
    for (const e of elements) {
      await client.query(`INSERT INTO diagram_element VALUES ($1, $2, $3, $4)`, [dGolf, e.svgElementId, e.entityKind, e.entityId]);
    }

    // pin specifications (expected values)
    const spec = async (nodeId: number, refNode: number | null, condition: string, measure: string, min: number | null, max: number | null, unit: string) =>
      id(`INSERT INTO pin_spec (node_id, ref_node_id, condition, measure, expected_min, expected_max, unit) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [nodeId, refNode, condition, measure, min, max, unit]);
    const psEcmSupply = await spec(ecm.bplus, ecm.gnd, 'Contact mis', 'voltage_dc', 11.5, 14.8, 'V');
    const psEcmGndDrop = await spec(ecm.gnd, nBattNeg, 'Moteur tournant, consommateurs allumés', 'voltage_dc', 0, 0.1, 'V');
    const psTcmSupply = await spec(tcm.bplus, tcm.gnd, 'Contact mis', 'voltage_dc', 11.5, 14.8, 'V');
    const psTcmGndDrop = await spec(tcm.gnd, nBattNeg, 'Moteur tournant', 'voltage_dc', 0, 0.1, 'V');
    const psGnd12Drop = await spec(nGnd12, nBattNeg, 'Moteur tournant, phares + dégivrage allumés', 'voltage_dc', 0, 0.1, 'V');
    const psCanTerm = await spec(gw.canh, gw.canl, 'Contact coupé, batterie débranchée, attendre 5 min', 'resistance', 55, 65, 'Ω');
    const psCanHVolt = await spec(gw.canh, nBattNeg, 'Contact mis', 'voltage_dc', 2.5, 3.5, 'V');
    const psG28Ref = await spec(g28.ref5, g28.gnd, 'Contact mis, connecteur débranché', 'voltage_dc', 4.5, 5.5, 'V');
    const psG28Wire = await spec(ecm.sig, g28.sig, 'Contact coupé, connecteurs débranchés', 'resistance', 0, 1.5, 'Ω');
    const psG28Short = await spec(g28.sig, nBattNeg, 'Contact coupé, connecteurs débranchés', 'resistance', 20000, null, 'Ω');
    const psBattRest = await spec(nBattPos, nBattNeg, 'Repos > 2 h, contact coupé', 'voltage_dc', 12.4, 12.9, 'V');
    const psCharge = await spec(nBattPos, nBattNeg, 'Moteur au ralenti, 2 000 tr/min, consommateurs allumés', 'voltage_dc', 13.8, 14.8, 'V');

    // test procedures
    const tp = async (o: { title: string; component?: number | null; minutes: number; intr: number; hv?: boolean; tools?: string[]; g: number; target?: string; bus?: number | null; node?: number | null }) =>
      id(`INSERT INTO test_procedure (title, component_id, est_minutes, intrusiveness, requires_hv_isolation, tools, applicability_group_id, source_id, target_kind, bus_id, node_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [o.title, o.component ?? null, o.minutes, o.intr, !!o.hv, o.tools ?? [], o.g, SRC, o.target ?? 'component', o.bus ?? null, o.node ?? null]);
    const step = async (proc: number, seq: number, text: string, pinSpec: number | null = null) =>
      id(`INSERT INTO test_step (procedure_id, seq, instruction_md, pin_spec_id) VALUES ($1,$2,$3,$4) RETURNING id`, [proc, seq, text, pinSpec]);

    const tGnd12 = await tp({ title: 'Chute de tension au point de masse 12', minutes: 6, intr: 1, tools: ['Multimètre'], g: gGolf, target: 'node', node: nGnd12 });
    await step(tGnd12, 1, 'Moteur tournant, allumer phares et dégivrage. Mesurer la tension entre le **point de masse 12** et la **borne − de la batterie**.', psGnd12Drop);
    await step(tGnd12, 2, 'Contrôler visuellement le point de masse 12 : corrosion, écrou desserré, cosse endommagée.');

    const tCan = await tp({ title: 'Contrôle du CAN propulsion (terminaison et niveaux)', minutes: 10, intr: 2, tools: ['Multimètre', 'Boîtier de dérivation'], g: gGolf, target: 'bus', bus: busPT });
    await step(tCan, 1, 'Contact mis : mesurer la tension CAN-H par rapport à la masse au connecteur **T20 de J533** (broche 6).', psCanHVolt);
    await step(tCan, 2, 'Contact coupé, batterie débranchée : mesurer la résistance entre **T20/6 (CAN-H)** et **T20/16 (CAN-L)**. 60 Ω = deux résistances de terminaison en parallèle.', psCanTerm);

    const tEcmSupply = await tp({ title: 'Alimentation et masse du calculateur moteur J623', component: cECM, minutes: 12, intr: 2, tools: ['Multimètre', 'Boîtier de dérivation'], g: gGolf, target: 'ecu_supply' });
    await step(tEcmSupply, 1, 'Contact mis : mesurer la tension entre **T94/5** et **T94/1**.', psEcmSupply);
    await step(tEcmSupply, 2, 'Moteur tournant : chute de tension entre **T94/1** et la borne − batterie.', psEcmGndDrop);
    const tTcmSupply = await tp({ title: 'Alimentation et masse de la mécatronique J743', component: cTCM, minutes: 15, intr: 2, tools: ['Multimètre'], g: gGolf20, target: 'ecu_supply' });
    await step(tTcmSupply, 1, 'Contact mis : mesurer la tension entre **T25/1** et **T25/2**.', psTcmSupply);
    await step(tTcmSupply, 2, 'Moteur tournant : chute de tension entre **T25/2** et la borne − batterie.', psTcmGndDrop);

    const tEcmModule = await tp({ title: 'Calculateur moteur : communication, codage et version logicielle', component: cECM, minutes: 20, intr: 3, tools: ['Outil de diagnostic'], g: gGolf });
    await step(tEcmModule, 1, "Avec l'outil de diagnostic, vérifier que J623 répond à l'adresse 0x01 et que codage/version correspondent au véhicule. Le calculateur répond-il correctement ?");
    const tTcmModule = await tp({ title: 'Mécatronique : communication et adaptation', component: cTCM, minutes: 25, intr: 3, tools: ['Outil de diagnostic'], g: gGolf20 });
    await step(tTcmModule, 1, "Vérifier la communication avec J743 (adresse 0x02) et l'état des adaptations d'embrayage. Le calculateur répond-il correctement ?");

    const tBattery = await tp({ title: 'Test batterie (tension de repos + test de charge)', component: cBatt, minutes: 5, intr: 1, tools: ['Testeur batterie'], g: gGolf });
    await step(tBattery, 1, 'Mesurer la tension de repos de la batterie.', psBattRest);
    await step(tBattery, 2, 'Effectuer un test de charge (testeur conductance). Le résultat est-il « bonne batterie » ?');
    const tCharge = await tp({ title: "Tension de charge de l'alternateur", component: cAlt, minutes: 5, intr: 1, tools: ['Multimètre'], g: gGolf });
    await step(tCharge, 1, 'Moteur à 2 000 tr/min, consommateurs allumés : mesurer la tension aux bornes de la batterie.', psCharge);

    const tG28 = await tp({ title: 'Capteur G28 : alimentation et signal', component: cG28, minutes: 10, intr: 2, tools: ['Multimètre', 'Oscilloscope'], g: gGolf });
    await step(tG28, 1, 'Débrancher G28. Contact mis : mesurer la tension entre **T3/1** et **T3/3** côté faisceau.', psG28Ref);
    await step(tG28, 2, "Rebrancher, oscilloscope sur **T94/37** au démarreur : le signal carré 0–5 V est-il présent et régulier (pas de dent manquante en dehors de la cible) ?");
    const tG28Wire = await tp({ title: 'Continuité du fil de signal G28 → J623', component: cG28, minutes: 12, intr: 2, tools: ['Multimètre', 'Boîtier de dérivation'], g: gGolf });
    await step(tG28Wire, 1, 'Connecteurs débranchés : résistance entre **T94/37** et **T3/2**.', psG28Wire);
    const tG28Short = await tp({ title: 'Court-circuit à la masse du fil de signal G28', component: cG28, minutes: 8, intr: 2, tools: ['Multimètre'], g: gGolf });
    await step(tG28Short, 1, 'Connecteurs débranchés : résistance entre **T3/2** et la masse.', psG28Short);
    const tG28Conn = await tp({ title: 'Inspection connecteur T3 du G28', component: cG28, minutes: 3, intr: 1, tools: [], g: gGolf });
    await step(tG28Conn, 1, 'Inspecter le connecteur T3 : humidité, oxydation, broches écartées, verrou cassé. Le connecteur est-il en bon état ?');

    // DTCs
    const dtc = async (code: string, makeId: number | null, desc: string, system: string | null) =>
      id(`INSERT INTO dtc_definition (code, make_id, description, system) VALUES ($1,$2,$3,$4) RETURNING id`, [code, makeId, desc, system]);
    const dU0100 = await dtc('U0100', null, 'Perte de communication avec le calculateur moteur (ECM/PCM "A")', 'electrical.network');
    const dU0101 = await dtc('U0101', null, 'Perte de communication avec le calculateur de boîte (TCM)', 'electrical.network');
    const dP0562 = await dtc('P0562', null, 'Tension du système trop basse', 'electrical.charging');
    const dP0335 = await dtc('P0335', null, 'Circuit du capteur de position de vilebrequin "A" — dysfonctionnement', 'engine.management.sensors');
    const dP0087 = await dtc('P0087', null, 'Pression de rampe/système de carburant trop basse', 'engine.fuel.injection');
    const dP0A80 = await dtc('P0A80', null, 'Remplacer la batterie hybride', 'hybrid.battery');
    const dP0AA6 = await dtc('P0AA6', null, "Défaut d'isolement du système de tension hybride", 'hybrid.power');
    const dP0A7F = await dtc('P0A7F', null, 'Batterie hybride : détérioration', 'hybrid.battery');

    const link = async (d: number, g: number, setting: number | null, lost: number | null, cond: string | null = null) =>
      client.query(`INSERT INTO dtc_vehicle_link (dtc_id, applicability_group_id, setting_component_id, lost_comm_component_id, set_conditions) VALUES ($1,$2,$3,$4,$5)`,
        [d, g, setting, lost, cond]);
    await link(dU0100, gGolf, cGW, cECM, "Aucun message de J623 reçu pendant > 500 ms, contact mis");
    await link(dU0101, gGolf, cGW, cTCM, "Aucun message de J743 reçu pendant > 500 ms, contact mis");
    await link(dP0562, gGolf, cECM, null, 'Tension borne 30 < 10,5 V pendant > 2 s, moteur tournant');
    await link(dP0335, gGolf, cECM, null, 'Pas de signal régime pendant le démarrage alors que le signal arbre à cames est présent');

    const cause = async (d: number, g: number, kind: string, prior: number, test: number | null, o: { component?: number; wire?: number; bus?: number } = {}) =>
      client.query(`INSERT INTO dtc_cause (dtc_id, applicability_group_id, cause_kind, component_id, wire_id, bus_id, prior_weight, test_procedure_id, source_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [d, g, kind, o.component ?? null, o.wire ?? null, o.bus ?? null, prior, test, SRC]);
    await cause(dU0100, gGolf, 'power_supply', 0.3, tEcmSupply, { component: cECM });
    await cause(dU0100, gGolf, 'component', 0.12, tEcmModule, { component: cECM });
    await cause(dU0101, gGolf, 'power_supply', 0.3, tTcmSupply, { component: cTCM });
    await cause(dU0101, gGolf, 'component', 0.12, tTcmModule, { component: cTCM });
    await cause(dP0562, gGolf, 'component', 0.35, tBattery, { component: cBatt });
    await cause(dP0562, gGolf, 'component', 0.3, tCharge, { component: cAlt });
    await cause(dP0335, gGolf, 'component', 0.4, tG28, { component: cG28 });
    await cause(dP0335, gGolf, 'open_circuit', 0.25, tG28Wire, { component: cG28, wire: wG28Sig });
    await cause(dP0335, gGolf, 'short_to_ground', 0.15, tG28Short, { component: cG28, wire: wG28Sig });
    await cause(dP0335, gGolf, 'connector', 0.2, tG28Conn, { component: cG28 });
    void wEcmGnd;

    // TSB + field case
    const tsb1 = await id(`INSERT INTO tsb (make_id, oem_number, kind, title, symptom_md, remedy_md, published_at, applicability_group_id, source_id)
      VALUES ($1, 'DEMO-2019-07', 'tsb', 'Codes U0100/U0101 intermittents, voyants multiples au démarrage',
      'Perte de communication intermittente avec J623 et J743, souvent après lavage moteur ou par temps humide. Tension système basse possible (P0562).',
      'Contrôler le point de masse 12 sur la culasse. Nettoyer, appliquer de la graisse de protection, serrer au couple. Effacer les codes et effectuer un essai routier.',
      '2019-07-15', $2, $3) RETURNING id`, [vw, gGolf, SRC]);
    await client.query(`INSERT INTO tsb_dtc VALUES ($1,$2),($1,$3),($1,$4)`, [tsb1, dU0100, dU0101, dP0562]);
    await client.query(`INSERT INTO tsb (make_id, oem_number, kind, title, symptom_md, remedy_md, published_at, applicability_group_id, source_id)
      VALUES ($1, 'DEMO-R-2018-02', 'recall', 'Rappel : contrôle de fixation du faisceau moteur près de la ligne d''échappement',
      'Risque de frottement du faisceau sur certains véhicules.', 'Contrôler et repositionner le faisceau, ajouter le collier de maintien fourni.',
      '2018-02-01', $2, $3)`, [vw, gGolf, SRC]);

    const fc = async (g: number, symptom: string, cause: string, fix: string, km: number, dtcs: number[], o: { component?: number; node?: number } = {}, votes = 0) => {
      const fid = await id(`INSERT INTO field_case (org_id, author_id, symptom, root_cause, fix_md, mileage_km, status, verified_by, applicability_group_id, component_id, node_id)
        VALUES ($1,$2,$3,$4,$5,$6,'verified',$2,$7,$8,$9) RETURNING id`, [DEMO_ORG_ID, DEMO_USER_ID, symptom, cause, fix, km, g, o.component ?? null, o.node ?? null]);
      for (const d of dtcs) await client.query(`INSERT INTO field_case_dtc VALUES ($1,$2)`, [fid, d]);
      for (let i = 0; i < votes; i++) {
        await client.query(`INSERT INTO field_case_feedback VALUES ($1, gen_random_uuid(), 'fixed')`, [fid]);
      }
    };
    await fc(gGolf, 'Voyants ABS, moteur et boîte allumés au démarrage, disparaissent parfois en roulant', 'Point de masse 12 oxydé (écrou desserré)',
      'Déposer la cosse, poncer la portée, graisse de protection, serrer à 9 Nm. Effacer les codes.', 142000, [dU0100, dU0101, dP0562], { node: nGnd12 }, 4);
    await fc(gGolf, 'Moteur tourne au démarreur mais ne démarre pas, compte-tours à zéro', 'Connecteur T3 du G28 oxydé (infiltration d\'eau)',
      'Nettoyer le connecteur, remplacer le joint, appliquer un produit de contact.', 98000, [dP0335], { component: cG28 }, 2);

    // ===================================================================
    // CLIO IV — fuel system
    // ===================================================================
    const clECM = await comp('ECM', '120', 'Calculateur injection diesel', gClio, true, 'Compartiment moteur, avant gauche');
    const clRail = await comp('RAIL_PRESSURE_SENSOR', '147', 'Capteur de pression rampe', gClio, false, 'Sur la rampe commune');
    const clFilter = await comp('FUEL_FILTER', '-', 'Filtre à gazole', gClio, false, 'Compartiment moteur, côté droit');
    const clHP = await comp('HP_PUMP', '-', 'Pompe haute pression', gClio, false, 'Face avant moteur');
    const clIMV = await comp('IMV', '-', 'Régulateur de débit IMV', gClio, false, 'Sur la pompe haute pression');
    void clECM;
    await link(dP0087, gClio, clECM, null, 'Pression mesurée < consigne − 150 bar pendant > 3 s');
    const tFilter = await tp({ title: 'Contrôle circuit basse pression (filtre, prise d\'air)', component: clFilter, minutes: 15, intr: 2, tools: ['Manomètre de dépression'], g: gClio });
    await step(tFilter, 1, 'Brancher un manomètre de dépression en sortie de filtre. Au ralenti accéléré, la dépression reste-t-elle inférieure à la limite donnée par le constructeur (circuit non colmaté, pas de bulles d\'air) ?');
    const tRailSensor = await tp({ title: 'Capteur pression rampe : alimentation et cohérence', component: clRail, minutes: 10, intr: 2, tools: ['Multimètre', 'Outil de diagnostic'], g: gClio });
    await step(tRailSensor, 1, "Contact mis, moteur arrêté : la pression lue à l'outil de diagnostic est-elle proche de 0 bar (capteur cohérent) ?");
    const tIMV = await tp({ title: 'Régulateur IMV : résistance et commande', component: clIMV, minutes: 10, intr: 2, tools: ['Multimètre'], g: gClio });
    await step(tIMV, 1, "Mesurer la résistance de l'IMV connecteur débranché et comparer à la valeur constructeur. La valeur est-elle conforme ?");
    const tHP = await tp({ title: 'Débit de retour et pression de la pompe HP', component: clHP, minutes: 40, intr: 4, tools: ['Kit de mesure de débit de retour'], g: gClio });
    await step(tHP, 1, 'Mesurer le débit de retour injecteurs et la pression maxi au démarreur selon la méthode constructeur. Les valeurs sont-elles conformes ?');
    await cause(dP0087, gClio, 'mechanical', 0.35, tFilter, { component: clFilter });
    await cause(dP0087, gClio, 'component', 0.2, tRailSensor, { component: clRail });
    await cause(dP0087, gClio, 'component', 0.25, tIMV, { component: clIMV });
    await cause(dP0087, gClio, 'component', 0.2, tHP, { component: clHP });
    await fc(gClio, 'Perte de puissance en montée, P0087 mémorisé', 'Filtre à gazole colmaté (gazole de mauvaise qualité)',
      'Remplacer le filtre, purger le circuit, contrôler la présence d\'eau dans le réservoir.', 156000, [dP0087], { component: clFilter }, 3);

    // ===================================================================
    // YARIS HYBRID — HV system
    // ===================================================================
    const yHVB = await comp('HV_BATTERY', 'HV', 'Batterie haute tension NiMH', gYaris, false, 'Sous la banquette arrière');
    const yBECU = await comp('BATTERY_ECU', 'BECU', 'Calculateur batterie HT', gYaris, true, 'Sur la batterie HT');
    const yHVECU = await comp('HV_ECU', 'HV ECU', 'Calculateur gestion hybride', gYaris, true, 'Derrière la boîte à gants');
    const yInv = await comp('INVERTER', 'INV', 'Onduleur avec convertisseur', gYaris, false, 'Compartiment moteur, au-dessus de la boîte');
    const yFan = await comp('HV_FAN', 'FAN', 'Ventilateur de refroidissement batterie HT', gYaris, false, 'Sous la banquette arrière, côté droit');
    const yAC = await comp('AC_COMPRESSOR', 'ES', 'Compresseur de climatisation électrique', gYaris, false, 'Face avant moteur');
    const busY = await id(`INSERT INTO network_bus (name, protocol, bitrate_kbps, applicability_group_id) VALUES ('CAN Hybride', 'can_hs', 500, $1) RETURNING id`, [gYaris]);
    for (const c of [yBECU, yHVECU]) await client.query(`INSERT INTO bus_node VALUES ($1,$2,false,null)`, [busY, c]);
    await link(dP0A80, gYaris, yBECU, null, 'Écart de tension entre blocs > seuil pendant la charge/décharge');
    await link(dP0A7F, gYaris, yBECU, null, 'Résistance interne estimée hors limites');
    await link(dP0AA6, gYaris, yHVECU, null, "Résistance d'isolement HT/caisse inférieure au seuil");

    const tBlocks = await tp({ title: 'Tensions des blocs batterie (outil de diagnostic)', component: yHVB, minutes: 15, intr: 1, tools: ['Outil de diagnostic'], g: gYaris });
    await step(tBlocks, 1, "Relever les tensions des blocs pendant un cycle charge/décharge (accélération franche). L'écart maximal entre blocs reste-t-il dans la limite constructeur ?");
    const tFan = await tp({ title: 'Ventilateur et filtre de refroidissement batterie HT', component: yFan, minutes: 15, intr: 2, tools: [], g: gYaris });
    await step(tFan, 1, "Contrôler l'entrée d'air sous la banquette et le ventilateur (poussière, poils d'animaux). Le flux d'air est-il libre ?");
    const tBusbar = await tp({ title: 'Inspection des barres de connexion de la batterie HT', component: yHVB, minutes: 60, intr: 4, hv: true, tools: ['Gants isolants classe 0', 'Clé dynamométrique isolée'], g: gYaris });
    await step(tBusbar, 1, 'Batterie consignée : déposer le capot, inspecter les barres de connexion (corrosion, sulfatation). Sont-elles propres ?');
    const tIso = await tp({ title: "Mesure d'isolement HT (onduleur, compresseur, câbles)", component: yInv, minutes: 45, intr: 3, hv: true, tools: ['Mégohmmètre 500 V', 'Gants isolants classe 0'], g: gYaris });
    await step(tIso, 1, "Système consigné : mesurer l'isolement de chaque sous-ensemble HT par rapport à la caisse selon la méthode constructeur. Toutes les valeurs sont-elles au-dessus du seuil ?");
    const tACIso = await tp({ title: "Isolement du compresseur électrique (huile de compresseur)", component: yAC, minutes: 30, intr: 3, hv: true, tools: ['Mégohmmètre 500 V'], g: gYaris });
    await step(tACIso, 1, "Mesurer l'isolement du compresseur. Vérifier l'historique : une huile non isolante (PAG standard) a-t-elle été introduite lors d'une recharge ? La valeur est-elle conforme ?");
    await cause(dP0A80, gYaris, 'component', 0.45, tBlocks, { component: yHVB });
    await cause(dP0A80, gYaris, 'mechanical', 0.3, tFan, { component: yFan });
    await cause(dP0A80, gYaris, 'connector', 0.25, tBusbar, { component: yHVB });
    await cause(dP0A7F, gYaris, 'component', 0.5, tBlocks, { component: yHVB });
    await cause(dP0A7F, gYaris, 'mechanical', 0.35, tFan, { component: yFan });
    await cause(dP0AA6, gYaris, 'component', 0.4, tACIso, { component: yAC });
    await cause(dP0AA6, gYaris, 'component', 0.35, tIso, { component: yInv });
    await fc(gYaris, 'P0A80 après recharge de clim. chez un réparateur non spécialisé', 'Huile PAG standard dans le compresseur électrique : chute d\'isolement',
      'Rincer le circuit, remplacer le compresseur si nécessaire, recharger avec huile isolante (POE) adaptée.', 121000, [dP0AA6], { component: yAC }, 2);
    void yHVECU;

    // ===================================================================
    // Procedures + torque (demo values)
    // ===================================================================
    const proc = async (kind: string, title: string, system: string, g: number, body: Row) =>
      id(`INSERT INTO procedure (kind, title, system, render_mode, body, language, applicability_group_id, source_id)
          VALUES ($1,$2,$3,'structured',$4,'fr',$5,$6) RETURNING id`, [kind, title, system, JSON.stringify(body), g, SRC]);
    const torque = async (procId: number, component: number | null, fastener: string, stages: Row[], replace: boolean, g: number, hotspot: Row | null = null) =>
      client.query(`INSERT INTO torque_spec (procedure_id, component_id, fastener, stages, replace_fastener, hotspot, applicability_group_id, source_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [procId, component, fastener, JSON.stringify(stages), replace, hotspot ? JSON.stringify(hotspot) : null, g, SRC]);

    const pTB = await proc('r_and_r', 'Courroie de distribution et pompe à eau — dépose/repose', 'engine.timing', gGolf, {
      warnings: ['Ne jamais tourner le moteur en sens inverse.', 'Remplacer systématiquement les vis à serrage angulaire.'],
      steps: [
        'Déposer le cache moteur et la courroie d\'accessoires.',
        'Soutenir le moteur, déposer le support moteur côté distribution.',
        'Déposer les carters de distribution supérieur et inférieur.',
        'Caler le vilebrequin et l\'arbre à cames au PMH avec les outils de calage.',
        'Desserrer le galet tendeur, déposer la courroie, puis la pompe à eau si nécessaire.',
        'Reposer les éléments neufs, tendre la courroie selon le repère du galet.',
        'Déposer les outils de calage, faire 2 tours de vilebrequin et contrôler le calage.',
        'Reposer dans l\'ordre inverse en respectant les couples.',
      ],
      tools: ['T10050 — calage vilebrequin (démo)', 'T10490 — calage arbre à cames (démo)'],
    });
    await torque(pTB, null, 'Vis de poulie de vilebrequin', [{ nm: 150 }, { deg: 90 }], true, gGolf, { x: 0.32, y: 0.71 });
    await torque(pTB, null, 'Écrou du galet tendeur', [{ nm: 20 }, { deg: 45 }], true, gGolf, { x: 0.58, y: 0.44 });
    await torque(pTB, null, 'Vis de pompe à eau', [{ nm: 15 }], false, gGolf, { x: 0.47, y: 0.62 });
    await torque(pTB, null, 'Support moteur sur carrosserie', [{ nm: 50 }, { deg: 90 }], true, gGolf);
    const pG28 = await proc('r_and_r', 'Transmetteur de régime moteur G28 — dépose/repose', 'engine.management.sensors', gGolf, {
      warnings: ['Contrôler la cible magnétique : aucun débris métallique.'],
      steps: ['Débrancher le connecteur T3.', 'Déposer la vis de fixation.', 'Extraire le capteur, contrôler le joint torique.', 'Reposer avec un joint neuf légèrement huilé.'],
      tools: [],
    });
    await torque(pG28, cG28, 'Vis de fixation G28', [{ nm: 5 }], false, gGolf);
    await client.query(`UPDATE test_procedure SET procedure_ref = $1 WHERE id IN ($2,$3,$4)`, [pG28, tG28, tG28Wire, tG28Conn]);

    const pHV = await proc('hv_deactivation', 'Mise hors tension du système haute tension (consignation)', 'hybrid.safety', gYaris, {
      warnings: [
        "Intervention réservée au personnel habilité (B1VL / BCL selon NF C18-550).",
        "Données de démonstration : appliquer impérativement la procédure du constructeur.",
      ],
      steps: [
        'Équipement : gants isolants classe 0 contrôlés (test de gonflage), lunettes, VAT/multimètre CAT III 1000 V, outils isolés.',
        'Couper le contact (READY éteint), éloigner la clé intelligente à plus de 5 m du véhicule.',
        'Débrancher la borne négative de la batterie 12 V.',
        'Retirer la fiche de service (service plug) et la conserver sur soi. Baliser le véhicule.',
        'Attendre le temps de décharge des condensateurs indiqué par le constructeur (démo : 10 minutes).',
        "Vérifier le testeur sur une source connue, mesurer l'absence de tension aux bornes d'entrée de l'onduleur (< 12 V), revérifier le testeur.",
        'Consigner : date, heure, nom de l\'intervenant.',
      ],
    });
    void pHV;
    await proc('r_and_r', 'Kit de distribution — dépose/repose', 'engine.timing', gClio, {
      warnings: ['Moteur froid uniquement.'],
      steps: ['Déposer la roue AVD et le pare-boue.', 'Déposer la courroie d\'accessoires.', 'Caler le moteur (pige PMH).', 'Remplacer courroie et galets, tendre au repère.', 'Contrôler le calage après 2 tours.'],
      tools: ['Mot. 1430 (démo)', 'Mot. 1054 (démo)'],
    });

    // ===================================================================
    // Labor DAG + operations (demo times)
    // ===================================================================
    const stepIds: Record<string, number> = {};
    const lstep = async (key: string, code: string, name: string, hours: number, access: boolean, g: number, requires: string[] = []) => {
      const sid = await id(`INSERT INTO labor_step (code, name, hours, is_access, applicability_group_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [code, name, hours, access, g]);
      for (const r of requires) await client.query(`INSERT INTO labor_step_dependency VALUES ($1,$2)`, [sid, stepIds[r]]);
      stepIds[key] = sid;
      return sid;
    };
    const op = async (code: string, name: string, system: string, hours: number, g: number, steps: string[]) => {
      const oid = await id(`INSERT INTO labor_operation (code, name, system, oem_hours, applicability_group_id, source_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [code, name, system, hours, g, SRC]);
      for (const s of steps) await client.query(`INSERT INTO labor_operation_step VALUES ($1,$2)`, [oid, stepIds[s]]);
      return oid;
    };

    // Golf
    await lstep('g_cover', 'ENGINE_COVER', 'Cache moteur — d/r', 0.1, true, gGolf);
    await lstep('g_accbelt', 'ACC_BELT_RR', "Courroie d'accessoires — d/r", 0.3, true, gGolf, ['g_cover']);
    await lstep('g_support', 'ENGINE_SUPPORT_RR', 'Soutien moteur + support côté distribution — d/r', 0.6, true, gGolf, ['g_accbelt']);
    await lstep('g_tcovers', 'TIMING_COVERS_RR', 'Carters de distribution — d/r', 0.4, true, gGolf, ['g_support']);
    await lstep('g_tbelt', 'TIMING_BELT_RR', 'Courroie de distribution — d/r + calage', 1.0, true, gGolf, ['g_tcovers']);
    await lstep('g_wp', 'WATER_PUMP_REPLACE', 'Remplacement pompe à eau', 0.4, false, gGolf, ['g_tbelt']);
    await lstep('g_tens', 'TENSIONER_IDLERS_REPLACE', 'Remplacement galets tendeur/enrouleur', 0.4, false, gGolf, ['g_tbelt']);
    await lstep('g_coolant', 'COOLANT_DRAIN_FILL', 'Vidange/remplissage liquide de refroidissement + purge', 0.5, true, gGolf);
    await lstep('g_newacc', 'ACC_BELT_FIT_NEW', "Pose courroie d'accessoires neuve", 0.1, false, gGolf, ['g_accbelt']);
    await lstep('g_wheelsF', 'FRONT_WHEELS_RR', 'Roues avant — d/r', 0.3, true, gGolf);
    await lstep('g_padsF', 'FRONT_PADS_REPLACE', 'Plaquettes avant — remplacement', 0.5, false, gGolf, ['g_wheelsF']);
    await lstep('g_discsF', 'FRONT_DISCS_REPLACE', 'Disques avant — remplacement', 0.6, false, gGolf, ['g_wheelsF']);
    await lstep('g_lift', 'VEHICLE_LIFT', 'Véhicule sur pont', 0.1, true, gGolf);
    await lstep('g_oil', 'OIL_FILTER_CHANGE', 'Vidange huile + filtre', 0.5, false, gGolf, ['g_lift', 'g_cover']);
    await lstep('g_pollen', 'POLLEN_FILTER_CHANGE', "Filtre d'habitacle — remplacement", 0.3, false, gGolf);
    await lstep('g_fuelf', 'FUEL_FILTER_CHANGE', 'Filtre à gazole — remplacement + purge', 0.6, false, gGolf, ['g_cover']);
    await lstep('g_bfluid', 'BRAKE_FLUID_CHANGE', 'Remplacement liquide de frein', 0.6, false, gGolf, ['g_lift']);
    await lstep('g_gnd12', 'GROUND12_REPAIR', 'Remise en état point de masse 12', 0.4, false, gGolf, ['g_cover']);

    const oGolf: Record<string, number> = {};
    oGolf.TB = await op('TIMING_BELT_KIT', 'Kit de distribution (courroie + galets)', 'engine.timing', 2.8, gGolf, ['g_tens']);
    oGolf.WP = await op('WATER_PUMP', 'Pompe à eau (distribution entraînée)', 'engine.cooling', 3.3, gGolf, ['g_wp', 'g_coolant']);
    oGolf.ACC = await op('ACC_BELT', "Courroie d'accessoires", 'engine.accessories', 0.5, gGolf, ['g_newacc']);
    oGolf.PADS = await op('FRONT_PADS', 'Plaquettes de frein avant', 'chassis.brakes', 0.8, gGolf, ['g_padsF']);
    oGolf.DISCS = await op('FRONT_DISCS_PADS', 'Disques + plaquettes avant', 'chassis.brakes', 1.4, gGolf, ['g_padsF', 'g_discsF']);
    oGolf.OIL = await op('OIL_SERVICE', 'Vidange moteur + filtre à huile', 'engine.lubrication', 0.7, gGolf, ['g_oil']);
    oGolf.POLLEN = await op('POLLEN_FILTER', "Filtre d'habitacle", 'hvac.filter', 0.3, gGolf, ['g_pollen']);
    oGolf.FUEL = await op('FUEL_FILTER', 'Filtre à gazole', 'engine.fuel.supply', 0.7, gGolf, ['g_fuelf']);
    oGolf.BFLUID = await op('BRAKE_FLUID', 'Liquide de frein', 'chassis.brakes', 0.7, gGolf, ['g_bfluid']);
    oGolf.GND12 = await op('GROUND12_REPAIR', 'Réparation point de masse 12', 'electrical.grounds', 0.5, gGolf, ['g_gnd12']);
    // explicit OEM pair rule example (pads + discs/pads would double-count pads)
    await client.query(`INSERT INTO labor_overlap_rule VALUES ($1,$2,$3)`, [Math.min(oGolf.PADS, oGolf.DISCS), Math.max(oGolf.PADS, oGolf.DISCS), 0.8]);

    // Clio
    await lstep('c_wheelR', 'RIGHT_FRONT_WHEEL_RR', 'Roue AVD + pare-boue — d/r', 0.3, true, gClio);
    await lstep('c_acc', 'ACC_BELT_RR', "Courroie d'accessoires — d/r", 0.3, true, gClio, ['c_wheelR']);
    await lstep('c_mount', 'ENGINE_MOUNT_RR', 'Soutien moteur + suspension pendulaire — d/r', 0.5, true, gClio, ['c_acc']);
    await lstep('c_tcover', 'TIMING_COVER_RR', 'Carter de distribution — d/r', 0.3, true, gClio, ['c_mount']);
    await lstep('c_tbelt', 'TIMING_BELT_RR', 'Courroie de distribution — d/r + calage', 1.1, true, gClio, ['c_tcover']);
    await lstep('c_tens', 'TENSIONER_REPLACE', 'Galets — remplacement', 0.5, false, gClio, ['c_tbelt']);
    await lstep('c_wp', 'WATER_PUMP_REPLACE', 'Pompe à eau — remplacement', 0.5, false, gClio, ['c_tbelt']);
    await lstep('c_cool', 'COOLANT_DRAIN_FILL', 'Liquide de refroidissement — vidange/remplissage/purge', 0.4, true, gClio);
    await lstep('c_lift', 'VEHICLE_LIFT', 'Véhicule sur pont', 0.1, true, gClio);
    await lstep('c_oil', 'OIL_FILTER_CHANGE', 'Vidange huile + filtre', 0.5, false, gClio, ['c_lift']);
    await lstep('c_fuelf', 'FUEL_FILTER_CHANGE', 'Filtre à gazole — remplacement + amorçage', 0.5, false, gClio);
    await lstep('c_wheelsF', 'FRONT_WHEELS_RR', 'Roues avant — d/r', 0.3, true, gClio);
    await lstep('c_padsF', 'FRONT_PADS_REPLACE', 'Plaquettes avant — remplacement', 0.5, false, gClio, ['c_wheelsF']);
    await op('TIMING_BELT_KIT', 'Kit de distribution', 'engine.timing', 3.0, gClio, ['c_tens']);
    await op('WATER_PUMP', 'Pompe à eau', 'engine.cooling', 3.4, gClio, ['c_wp', 'c_cool']);
    await op('OIL_SERVICE', 'Vidange moteur + filtre à huile', 'engine.lubrication', 0.6, gClio, ['c_oil']);
    await op('FUEL_FILTER', 'Filtre à gazole', 'engine.fuel.supply', 0.5, gClio, ['c_fuelf']);
    await op('FRONT_PADS', 'Plaquettes de frein avant', 'chassis.brakes', 0.8, gClio, ['c_padsF']);

    // Yaris
    await lstep('y_seat', 'REAR_SEAT_RR', 'Banquette arrière — d/r', 0.3, true, gYaris);
    await lstep('y_fan', 'HV_FAN_CLEAN', 'Ventilateur + conduit batterie HT — nettoyage', 0.5, false, gYaris, ['y_seat']);
    await lstep('y_lift', 'VEHICLE_LIFT', 'Véhicule sur pont', 0.1, true, gYaris);
    await lstep('y_oil', 'OIL_FILTER_CHANGE', 'Vidange huile + filtre', 0.4, false, gYaris, ['y_lift']);
    await lstep('y_wheelsF', 'FRONT_WHEELS_RR', 'Roues avant — d/r', 0.3, true, gYaris);
    await lstep('y_padsF', 'FRONT_PADS_REPLACE', 'Plaquettes avant — remplacement', 0.5, false, gYaris, ['y_wheelsF']);
    await lstep('y_bfluid', 'BRAKE_FLUID_CHANGE', 'Liquide de frein (procédure outil de diag)', 0.8, false, gYaris, ['y_lift']);
    await op('HV_FAN_SERVICE', 'Nettoyage refroidissement batterie HT', 'hybrid.battery.cooling', 0.8, gYaris, ['y_fan']);
    await op('OIL_SERVICE', 'Vidange moteur + filtre à huile', 'engine.lubrication', 0.5, gYaris, ['y_oil']);
    await op('FRONT_PADS', 'Plaquettes de frein avant', 'chassis.brakes', 0.8, gYaris, ['y_padsF']);
    await op('BRAKE_FLUID', 'Liquide de frein', 'chassis.brakes', 0.9, gYaris, ['y_bfluid']);

    // ===================================================================
    // Maintenance schedules + fluids (demo)
    // ===================================================================
    const sched = async (g: number, items: [string, number | null, number | null, number | null, number | null, string | null][]) => {
      const sid = await id(`INSERT INTO maintenance_schedule (regime, applicability_group_id, source_id) VALUES ('normal', $1, $2) RETURNING id`, [g, SRC]);
      for (const [task, km, mo, fkm, fmo, opCode] of items) {
        const opId = opCode ? (await one(`SELECT id FROM labor_operation WHERE code = $1 AND applicability_group_id = $2`, [opCode, g]))?.id ?? null : null;
        await client.query(`INSERT INTO maintenance_item (schedule_id, task, operation_id, interval_km, interval_months, first_at_km, first_at_months)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [sid, task, opId, km, mo, fkm, fmo]);
      }
    };
    await sched(gGolf, [
      ['Vidange moteur + filtre à huile', 15000, 12, null, null, 'OIL_SERVICE'],
      ["Filtre d'habitacle", 30000, 24, null, null, 'POLLEN_FILTER'],
      ['Filtre à gazole', 60000, 48, null, null, 'FUEL_FILTER'],
      ['Liquide de frein', null, 24, null, 36, 'BRAKE_FLUID'],
      ['Kit de distribution + pompe à eau', 210000, null, null, null, 'TIMING_BELT_KIT'],
      ["Courroie d'accessoires (contrôle / remplacement)", 60000, null, null, null, 'ACC_BELT'],
    ]);
    await sched(gClio, [
      ['Vidange moteur + filtre à huile', 20000, 12, null, null, 'OIL_SERVICE'],
      ['Filtre à gazole', 40000, 24, null, null, 'FUEL_FILTER'],
      ['Kit de distribution + pompe à eau', 120000, 72, null, null, 'TIMING_BELT_KIT'],
    ]);
    await sched(gYaris, [
      ['Vidange moteur + filtre à huile', 15000, 12, null, null, 'OIL_SERVICE'],
      ['Nettoyage filtre/ventilateur batterie HT', 30000, 24, null, null, 'HV_FAN_SERVICE'],
      ['Liquide de frein', null, 24, null, 36, 'BRAKE_FLUID'],
    ]);
    const fluid = async (g: number, system: string, cap: number, specification: string, visc: string | null, unit = 'l') =>
      client.query(`INSERT INTO fluid_spec (system, capacity, unit, specification, viscosity, applicability_group_id, source_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [system, cap, unit, specification, visc, g, SRC]);
    await fluid(gGolf20, "Huile moteur (avec filtre)", 4.6, 'VW 507 00', '5W-30');
    await fluid(gGolf16, "Huile moteur (avec filtre)", 4.3, 'VW 507 00', '5W-30');
    await fluid(gGolf20, 'Huile boîte DSG DQ250', 5.2, 'Huile DSG spécifique', null);
    await fluid(gGolf, 'Liquide de refroidissement', 8.0, 'G13', null);
    await fluid(gGolf, 'Liquide de frein', 0.9, 'DOT 4 classe 6', null);
    await fluid(gClio, 'Huile moteur (avec filtre)', 4.5, 'RN0720', '5W-30');
    await fluid(gClio, 'Liquide de refroidissement', 5.5, 'Glacéol RX type D', null);
    await fluid(gYaris, 'Huile moteur (avec filtre)', 3.4, 'API SN / ILSAC GF-5', '0W-20');
    await fluid(gYaris, 'Liquide de refroidissement onduleur', 1.6, 'Toyota Super Long Life Coolant', null);
    await fluid(gYaris, 'Réfrigérant + huile compresseur', 0.37, 'R1234yf + huile isolante ND-11', null, 'kg');

    await client.query('COMMIT');
    console.log('Demo data seeded: 4 variants (Golf VII ×2, Clio IV, Yaris Hybrid), 1 interactive diagram, 8 DTCs.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

if (require.main === module) {
  (async () => {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await seed(client);
    await client.end();
  })().catch(e => { console.error(e); process.exit(1); });
}
