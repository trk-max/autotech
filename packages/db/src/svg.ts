/**
 * Netlist → interactive SVG generator (svg-kit).
 * Every drawable entity gets a stable id + data-kind/data-entity attributes so the
 * viewer can map clicks to the electrical graph, and the diagram_element table maps back.
 */

export interface SvgComponent { entityId: number; ref: string; label: string; x: number; y: number; w: number; h: number; ecu?: boolean }
export interface SvgNode { entityId: number; kind: 'pin' | 'splice' | 'ground' | 'fuse' | 'inline_connector' | 'relay_terminal'; label: string; x: number; y: number; anchor?: 'left' | 'right' | 'top' | 'bottom' }
export interface SvgWire { entityId: number; points: [number, number][]; colourPrimary: string; colourStripe?: string | null; label?: string; signal: string }
export interface DiagramElement { svgElementId: string; entityKind: 'wire' | 'node' | 'component' | 'connector' | 'ground'; entityId: number }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function renderDiagram(input: {
  diagramId: number; title: string; width: number; height: number;
  components: SvgComponent[]; nodes: SvgNode[]; wires: SvgWire[];
}): { svg: string; elements: DiagramElement[] } {
  const elements: DiagramElement[] = [];
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${input.width} ${input.height}" data-diagram="${input.diagramId}" font-family="Barlow, Arial, sans-serif">`);
  parts.push(`<title>${esc(input.title)}</title>`);
  parts.push(`<g id="viewport">`);
  parts.push(`<rect class="sheet" x="0" y="0" width="${input.width}" height="${input.height}"/>`);

  parts.push(`<g id="layer-components">`);
  for (const c of input.components) {
    const id = `c-${c.entityId}`;
    elements.push({ svgElementId: id, entityKind: 'component', entityId: c.entityId });
    parts.push(
      `<g id="${id}" class="comp${c.ecu ? ' ecu' : ''}" data-kind="component" data-entity="${c.entityId}">` +
      `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="6"/>` +
      `<text class="comp-ref" x="${c.x + 10}" y="${c.y + 22}">${esc(c.ref)}</text>` +
      `<text class="comp-label" x="${c.x + 10}" y="${c.y + 40}">${esc(c.label)}</text></g>`,
    );
  }
  parts.push(`</g>`);

  parts.push(`<g id="layer-wires">`);
  for (const w of input.wires) {
    const id = `w-${w.entityId}`;
    elements.push({ svgElementId: id, entityKind: 'wire', entityId: w.entityId });
    const d = w.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
    const colour = `${w.colourPrimary}${w.colourStripe ? '/' + w.colourStripe : ''}`;
    parts.push(
      `<g id="${id}" class="wire sig-${w.signal}" data-kind="wire" data-entity="${w.entityId}" data-color="${esc(colour)}">` +
      `<path class="hit" d="${d}"/>` +
      `<path class="core c-${w.colourPrimary}" d="${d}"/>` +
      (w.colourStripe ? `<path class="stripe c-${w.colourStripe}" d="${d}"/>` : '') +
      (w.label ? `<text class="wire-label" x="${(w.points[0]![0] + w.points[1]![0]) / 2}" y="${(w.points[0]![1] + w.points[1]![1]) / 2 - 6}">${esc(colour)} · ${esc(w.label)}</text>` : '') +
      `</g>`,
    );
  }
  parts.push(`</g>`);

  parts.push(`<g id="layer-nodes">`);
  for (const n of input.nodes) {
    const id = `n-${n.entityId}`;
    const kind = n.kind === 'ground' ? 'ground' : 'node';
    elements.push({ svgElementId: id, entityKind: kind, entityId: n.entityId });
    const lx = n.anchor === 'left' ? n.x - 8 : n.x + 8;
    const ta = n.anchor === 'left' ? 'end' : 'start';
    let glyph: string;
    if (n.kind === 'ground') {
      glyph = `<path class="gnd" d="M${n.x} ${n.y} V${n.y + 10} M${n.x - 12} ${n.y + 10} H${n.x + 12} M${n.x - 8} ${n.y + 15} H${n.x + 8} M${n.x - 4} ${n.y + 20} H${n.x + 4}"/>`;
    } else if (n.kind === 'fuse') {
      glyph = `<rect class="fuse" x="${n.x - 14}" y="${n.y - 6}" width="28" height="12" rx="3"/>`;
    } else if (n.kind === 'splice') {
      glyph = `<circle class="splice" cx="${n.x}" cy="${n.y}" r="5"/>`;
    } else {
      glyph = `<circle class="pin" cx="${n.x}" cy="${n.y}" r="4"/>`;
    }
    const ly = n.kind === 'ground' ? n.y + 34 : n.y - 8;
    const lxx = n.kind === 'ground' ? n.x : lx;
    parts.push(
      `<g id="${id}" class="node node-${n.kind}" data-kind="${kind}" data-entity="${n.entityId}">` +
      `<circle class="hit" cx="${n.x}" cy="${n.y}" r="10"/>${glyph}` +
      `<text class="node-label" x="${lxx}" y="${ly}" text-anchor="${n.kind === 'ground' ? 'middle' : ta}">${esc(n.label)}</text></g>`,
    );
  }
  parts.push(`</g></g></svg>`);
  return { svg: parts.join('\n'), elements };
}
