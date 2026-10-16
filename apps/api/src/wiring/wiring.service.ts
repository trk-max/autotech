import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, applies } from '../db/db.service';
import { config } from '../config';

const NODE_SQL = `
  SELECT n.id, n.kind, n.pin_label AS "pinLabel", n.name, n.location_text AS location,
         k.id AS "connectorId", k.code AS "connectorCode", c.id AS "componentId", c.oem_ref AS "componentRef", c.name AS "componentName"
  FROM electrical_node n
  LEFT JOIN connector k ON k.id = n.connector_id
  LEFT JOIN component c ON c.id = k.component_id`;

@Injectable()
export class WiringService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  diagramsForVariant(variantId: number) {
    return this.db.query(
      `SELECT d.id, d.title, d.system::text AS system, d.render_mode AS "renderMode", d.version
       FROM wiring_diagram d WHERE ${applies('d')} ORDER BY d.system, d.title`, [variantId]);
  }

  async diagram(id: number) {
    const d = await this.db.one(
      `SELECT d.id, d.title, d.system::text AS system, d.render_mode AS "renderMode", d.version, d.asset_sha256 AS sha256,
              s.name AS "sourceName", s.origin AS "sourceOrigin"
       FROM wiring_diagram d JOIN data_source s ON s.id = d.source_id WHERE d.id = $1`, [id]);
    if (!d) throw new NotFoundException('Schéma introuvable');
    const legend = await this.db.query(
      `SELECT DISTINCT w.colour_primary AS primary, w.colour_stripe AS stripe, w.signal
       FROM diagram_element de JOIN wire w ON w.id = de.entity_id
       WHERE de.diagram_id = $1 AND de.entity_kind = 'wire' ORDER BY w.signal`, [id]);
    return { ...d, svgUrl: `/api/diagrams/${id}/svg?v=${d.sha256.slice(0, 12)}`, legend };
  }

  async svgPath(id: number): Promise<string> {
    const d = await this.db.one<{ asset_key: string }>(`SELECT asset_key FROM wiring_diagram WHERE id = $1`, [id]);
    if (!d) throw new NotFoundException('Schéma introuvable');
    const file = path.resolve(config.storageDir, d.asset_key);
    if (!file.startsWith(config.storageDir + path.sep) || !fs.existsSync(file)) {
      throw new NotFoundException('Fichier du schéma absent du stockage (relancez pnpm db:reset)');
    }
    return file;
  }

  /**
   * Electrical net of a wire: follows wires through splices and inline connectors,
   * stops at component pins, fuses and grounds. Returns SVG element ids to highlight.
   */
  async trace(diagramId: number, wireId: number) {
    const rows = await this.db.query<{ id: number; from_node_id: number; to_node_id: number }>(`
      WITH RECURSIVE net AS (
        SELECT w.id, w.from_node_id, w.to_node_id, 0 AS depth FROM wire w WHERE w.id = $1
        UNION
        SELECT w.id, w.from_node_id, w.to_node_id, n.depth + 1
        FROM net n
        JOIN electrical_node en ON en.id IN (n.from_node_id, n.to_node_id) AND en.kind IN ('splice','inline_connector')
        JOIN wire w ON w.from_node_id = en.id OR w.to_node_id = en.id
        WHERE n.depth < 50
      )
      SELECT DISTINCT id, from_node_id, to_node_id FROM net`, [wireId]);
    if (!rows.length) throw new NotFoundException('Fil introuvable');
    const wireIds = rows.map(r => r.id);
    const nodeIds = [...new Set(rows.flatMap(r => [r.from_node_id, r.to_node_id]))];
    const elements = await this.db.query<{ svg_element_id: string }>(
      `SELECT svg_element_id FROM diagram_element
       WHERE diagram_id = $1 AND ((entity_kind = 'wire' AND entity_id = ANY($2)) OR (entity_kind IN ('node','ground') AND entity_id = ANY($3)))`,
      [diagramId, wireIds, nodeIds]);
    const endpoints = await this.db.query(`${NODE_SQL} WHERE n.id = ANY($1) AND n.kind <> 'splice' ORDER BY c.name NULLS LAST, n.name`, [nodeIds]);
    return { wireIds, nodeIds, svgElementIds: elements.map(e => e.svg_element_id), endpoints };
  }

  private async wiresAt(nodeIds: number[]) {
    return this.db.query(
      `SELECT w.id, w.colour_primary AS "colourPrimary", w.colour_stripe AS "colourStripe", w.cross_section_mm2 AS "crossSection",
              w.signal, w.circuit_label AS "circuitLabel", w.from_node_id AS "fromNodeId", w.to_node_id AS "toNodeId",
              fa.name AS "fromName", tb.name AS "toName"
       FROM wire w JOIN electrical_node fa ON fa.id = w.from_node_id JOIN electrical_node tb ON tb.id = w.to_node_id
       WHERE w.from_node_id = ANY($1) OR w.to_node_id = ANY($1) ORDER BY w.id`, [nodeIds]);
  }

  private async pinSpecs(nodeIds: number[]) {
    return this.db.query(
      `SELECT ps.id, ps.node_id AS "nodeId", ps.condition, ps.measure, ps.expected_min AS min, ps.expected_max AS max, ps.unit,
              n.name AS "nodeName", r.name AS "refName"
       FROM pin_spec ps JOIN electrical_node n ON n.id = ps.node_id LEFT JOIN electrical_node r ON r.id = ps.ref_node_id
       WHERE ps.node_id = ANY($1) OR ps.ref_node_id = ANY($1) ORDER BY ps.id`, [nodeIds]);
  }

  /** Selection panel content for a clicked SVG element. */
  async entity(kind: string, entityId: number) {
    if (kind === 'wire') {
      const w = await this.db.one(
        `SELECT w.id, w.colour_primary AS "colourPrimary", w.colour_stripe AS "colourStripe", w.cross_section_mm2 AS "crossSection",
                w.signal, w.circuit_label AS "circuitLabel", w.from_node_id AS "fromNodeId", w.to_node_id AS "toNodeId"
         FROM wire w WHERE w.id = $1`, [entityId]);
      if (!w) throw new NotFoundException('Fil introuvable');
      const ends = await this.db.query(`${NODE_SQL} WHERE n.id = ANY($1)`, [[w.fromNodeId, w.toNodeId]]);
      return { kind, wire: w, from: ends.find(e => e.id === w.fromNodeId), to: ends.find(e => e.id === w.toNodeId) };
    }
    if (kind === 'node' || kind === 'ground') {
      const node = await this.db.one(`${NODE_SQL} WHERE n.id = $1`, [entityId]);
      if (!node) throw new NotFoundException('Point introuvable');
      const pinout = node.connectorId
        ? await this.db.query(
          `SELECT n.id, n.pin_label AS "pinLabel", n.name,
                  (SELECT json_agg(json_build_object('colourPrimary', w.colour_primary, 'colourStripe', w.colour_stripe, 'signal', w.signal, 'circuitLabel', w.circuit_label))
                   FROM wire w WHERE w.from_node_id = n.id OR w.to_node_id = n.id) AS wires
           FROM electrical_node n WHERE n.connector_id = $1
           ORDER BY CASE WHEN n.pin_label ~ '^[0-9]+$' THEN n.pin_label::int END NULLS LAST, n.pin_label`, [node.connectorId])
        : [];
      const connector = node.connectorId
        ? await this.db.one(`SELECT id, code, cavity_count AS cavities, housing_colour AS colour, location_text AS location FROM connector WHERE id = $1`, [node.connectorId])
        : null;
      const consumers = kind === 'ground' || node.kind === 'fuse' ? await this.consumersOf(entityId) : [];
      return { kind, node, connector, pinout, wires: await this.wiresAt([entityId]), specs: await this.pinSpecs([entityId]), consumers };
    }
    if (kind === 'component') {
      const c = await this.db.one(
        `SELECT c.id, c.oem_ref AS ref, c.name, c.is_ecu AS "isEcu", c.location_text AS location, ct.name AS "typeName", ct.system::text AS system
         FROM component c JOIN component_type ct ON ct.id = c.type_id WHERE c.id = $1`, [entityId]);
      if (!c) throw new NotFoundException('Composant introuvable');
      const connectors = await this.db.query(
        `SELECT k.id, k.code, k.cavity_count AS cavities, k.housing_colour AS colour,
                (SELECT count(*)::int FROM electrical_node n WHERE n.connector_id = k.id) AS "usedPins"
         FROM connector k WHERE k.component_id = $1 ORDER BY k.code`, [entityId]);
      const buses = await this.db.query(
        `SELECT b.id, b.name, b.protocol, b.bitrate_kbps AS bitrate, bn.is_gateway AS "isGateway", bn.diag_address AS address
         FROM bus_node bn JOIN network_bus b ON b.id = bn.bus_id WHERE bn.component_id = $1`, [entityId]);
      const dtcs = await this.db.query(
        `SELECT DISTINCT d.id, d.code, d.description FROM dtc_definition d
         WHERE d.id IN (SELECT dtc_id FROM dtc_cause WHERE component_id = $1
                        UNION SELECT dtc_id FROM dtc_vehicle_link WHERE setting_component_id = $1 OR lost_comm_component_id = $1)
         ORDER BY d.code`, [entityId]);
      const tests = await this.db.query(`SELECT id, title, est_minutes AS minutes FROM test_procedure WHERE component_id = $1 ORDER BY intrusiveness, est_minutes`, [entityId]);
      const pins = await this.db.query<{ id: number }>(`SELECT n.id FROM electrical_node n JOIN connector k ON k.id = n.connector_id WHERE k.component_id = $1`, [entityId]);
      const specs = await this.pinSpecs(pins.map(p => p.id));
      const supply = await this.supplyNodes(entityId);
      return { kind, component: c, connectors, buses, dtcs, tests, specs, supply };
    }
    throw new NotFoundException('Type d\'élément inconnu');
  }

  /** Fuses and grounds feeding a component (follows power/ground wires through splices). */
  async supplyNodes(componentId: number) {
    return this.db.query(`
      WITH RECURSIVE walk AS (
        SELECT n.id AS node_id, 0 AS depth
        FROM electrical_node n JOIN connector k ON k.id = n.connector_id WHERE k.component_id = $1
        UNION
        SELECT CASE WHEN w.from_node_id = walk.node_id THEN w.to_node_id ELSE w.from_node_id END, walk.depth + 1
        FROM walk
        JOIN wire w ON (w.from_node_id = walk.node_id OR w.to_node_id = walk.node_id) AND w.signal IN ('power','ground')
        JOIN electrical_node cur ON cur.id = walk.node_id
        WHERE walk.depth < 20 AND (walk.depth = 0 OR cur.kind IN ('splice','inline_connector'))
      )
      SELECT DISTINCT n.id, n.kind, n.name, n.location_text AS location
      FROM walk JOIN electrical_node n ON n.id = walk.node_id
      WHERE n.kind IN ('fuse','ground')`, [componentId]);
  }

  /** Components fed by a fuse or ground node (reverse walk). */
  async consumersOf(nodeId: number) {
    return this.db.query(`
      WITH RECURSIVE walk AS (
        SELECT $1::bigint AS node_id, 0 AS depth
        UNION
        SELECT CASE WHEN w.from_node_id = walk.node_id THEN w.to_node_id ELSE w.from_node_id END, walk.depth + 1
        FROM walk
        JOIN wire w ON (w.from_node_id = walk.node_id OR w.to_node_id = walk.node_id) AND w.signal IN ('power','ground')
        JOIN electrical_node cur ON cur.id = walk.node_id
        WHERE walk.depth < 20 AND (walk.depth = 0 OR cur.kind IN ('splice','inline_connector'))
      )
      SELECT DISTINCT c.id, c.oem_ref AS ref, c.name, n.name AS pin
      FROM walk JOIN electrical_node n ON n.id = walk.node_id
      JOIN connector k ON k.id = n.connector_id JOIN component c ON c.id = k.component_id
      ORDER BY c.name`, [nodeId]);
  }
}
