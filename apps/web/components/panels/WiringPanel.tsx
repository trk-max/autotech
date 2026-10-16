'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { api, type DiagramMeta } from '@/lib/api';
import { useApp } from '@/lib/store';
import { MEASURE_LABEL, SIGNAL_LABEL, colourName, specRange } from '@/lib/format';
import { ErrorNote, Icon, Loading, NeedVehicle, useAsync } from '../ui';

type Selection = { kind: string; id: number; svgId: string } | null;

function Swatch({ p, s }: { p: string; s?: string | null }) {
  return (
    <svg width="34" height="10" aria-hidden className="inline-block align-middle">
      <line x1="0" y1="5" x2="34" y2="5" strokeWidth="4" style={{ stroke: `var(--wire-${p})` }} />
      {s && <line x1="0" y1="5" x2="34" y2="5" strokeWidth="4" strokeDasharray="5 6" style={{ stroke: s === 'sw' ? '#0b0f14' : `var(--wire-${s})` }} />}
    </svg>
  );
}

function Viewer({ diagram, onSelect, selection }: { diagram: DiagramMeta; onSelect: (s: Selection) => void; selection: Selection }) {
  const host = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [traced, setTraced] = useState<string[]>([]);
  const [endpoints, setEndpoints] = useState<{ name: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [ready, setReady] = useState(false);
  const focus = useApp(s => s.wiringFocus);

  useEffect(() => {
    let cancelled = false;
    setReady(false); setTraced([]); setError(null);
    fetch(diagram.svgUrl).then(r => { if (!r.ok) throw new Error(`Schéma indisponible (${r.status})`); return r.text(); }).then(raw => {
      if (cancelled || !host.current) return;
      host.current.innerHTML = DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true }, ADD_ATTR: ['data-kind', 'data-entity', 'data-color', 'data-diagram'] });
      const svgEl = host.current.querySelector('svg');
      if (!svgEl) throw new Error('SVG invalide');
      const svg = select(svgEl as SVGSVGElement);
      const vp = svg.select<SVGGElement>('#viewport');
      const z = zoom<SVGSVGElement, unknown>().scaleExtent([0.4, 12]).clickDistance(4)
        .on('zoom', ev => vp.attr('transform', ev.transform.toString()));
      svg.call(z);
      svg.on('dblclick.zoom', null);
      zoomRef.current = z;
      setReady(true);
    }).catch(e => !cancelled && setError(e));
    return () => { cancelled = true; };
  }, [diagram.svgUrl]);

  // apply trace + selection classes
  useEffect(() => {
    const root = host.current;
    if (!root || !ready) return;
    root.querySelectorAll('.traced').forEach(n => n.classList.remove('traced'));
    root.querySelectorAll('.selected').forEach(n => n.classList.remove('selected'));
    root.classList.toggle('has-trace', traced.length > 0);
    for (const id of traced) root.querySelector(`#${CSS.escape(id)}`)?.classList.add('traced');
    if (selection) root.querySelector(`#${CSS.escape(selection.svgId)}`)?.classList.add('selected');
  }, [traced, selection, ready]);

  // focus a node requested by the diagnostic wizard
  useEffect(() => {
    const root = host.current;
    if (!root || !ready || !focus || focus.diagramId !== diagram.id) return;
    const el = root.querySelector<SVGGraphicsElement>(`#${CSS.escape(focus.svgElementId)}`);
    const svgEl = root.querySelector('svg');
    if (!el || !svgEl || !zoomRef.current) return;
    const b = el.getBBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const vb = svgEl.viewBox.baseVal;
    const k = 2.4;
    select(svgEl as SVGSVGElement).call(zoomRef.current.transform, zoomIdentity.translate(vb.width / 2 - cx * k, vb.height / 2 - cy * k).scale(k));
    root.querySelectorAll('.focus-ring').forEach(n => n.remove());
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('class', 'focus-ring'); ring.setAttribute('cx', String(cx)); ring.setAttribute('cy', String(cy)); ring.setAttribute('r', '8');
    root.querySelector('#viewport')?.appendChild(ring);
    const id = Number(el.getAttribute('data-entity'));
    onSelect({ kind: el.getAttribute('data-kind') ?? 'node', id, svgId: focus.svgElementId });
  }, [focus, ready, diagram.id, onSelect]);

  const onClick = async (ev: React.MouseEvent) => {
    const el = (ev.target as Element).closest('[data-kind]');
    if (!el) { setTraced([]); setEndpoints([]); onSelect(null); return; }
    const kind = el.getAttribute('data-kind')!;
    const id = Number(el.getAttribute('data-entity'));
    onSelect({ kind, id, svgId: el.id });
    if (kind === 'wire') {
      try {
        const t = await api.get<{ svgElementIds: string[]; endpoints: { name: string }[] }>(`/diagrams/${diagram.id}/trace`, { wire: id });
        setTraced(t.svgElementIds); setEndpoints(t.endpoints);
      } catch (e) { setError(e); }
    } else {
      setTraced([]); setEndpoints([]);
    }
  };

  const reset = () => {
    const svgEl = host.current?.querySelector('svg');
    if (svgEl && zoomRef.current) select(svgEl as SVGSVGElement).call(zoomRef.current.transform, zoomIdentity);
    setTraced([]); setEndpoints([]); onSelect(null);
    host.current?.querySelectorAll('.focus-ring').forEach(n => n.remove());
  };

  return (
    <div className="relative h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--line)] text-[13.5px]">
        <span className="text-ink-2 flex-1 truncate">
          {traced.length ? <>Circuit tracé : <span className="text-instrument">{endpoints.map(e => e.name.split(' — ')[0]).join(' · ')}</span></> : 'Cliquez un fil pour tracer le circuit, un composant ou une broche pour ses détails. Molette : zoom.'}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={reset}>Réinitialiser</button>
      </div>
      <ErrorNote error={error} />
      {!ready && !error && <Loading label="Chargement du schéma…" />}
      <div ref={host} className="wiring-host flex-1 min-h-[360px]" onClick={onClick}
        onKeyDown={e => { if (e.key === 'Escape') reset(); }} tabIndex={0} role="application" aria-label={`Schéma : ${diagram.title}`} />
    </div>
  );
}

function Details({ sel }: { sel: Selection }) {
  const { open } = useApp();
  const q = useAsync(() => (sel ? api.get<any>(`/wiring/entity/${sel.kind}/${sel.id}`) : Promise.resolve(null)), [sel?.kind, sel?.id]);
  if (!sel) return <p className="text-muted text-[14px] p-4">Aucun élément sélectionné.</p>;
  if (q.loading) return <div className="p-4"><Loading /></div>;
  if (q.error) return <div className="p-4"><ErrorNote error={q.error} /></div>;
  const d = q.data;
  if (!d) return null;

  const specs = (list: any[]) => list.length > 0 && (
    <div className="mt-4">
      <h4 className="cond text-[16px] font-semibold mb-1.5">Valeurs attendues</h4>
      <ul className="space-y-2">
        {list.map(s => (
          <li key={s.id} className="text-[13.5px]">
            <div className="cond text-[18px] font-semibold">{specRange(s.min, s.max, s.unit)}</div>
            <div className="text-ink-2">{MEASURE_LABEL[s.measure]} entre {s.nodeName} et {s.refName ?? 'masse'}</div>
            <div className="text-muted">{s.condition}</div>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="p-4 text-[14px]">
      {d.kind === 'wire' && (
        <>
          <div className="flex items-center gap-2"><Swatch p={d.wire.colourPrimary} s={d.wire.colourStripe} /><h3 className="text-[20px]">Fil {colourName(d.wire.colourPrimary, d.wire.colourStripe)}</h3></div>
          <dl className="grid grid-cols-2 gap-2 mt-3">
            <div><dt className="text-muted">Section</dt><dd className="cond text-[18px]">{String(d.wire.crossSection).replace('.', ',')} mm²</dd></div>
            <div><dt className="text-muted">Fonction</dt><dd className="cond text-[18px]">{SIGNAL_LABEL[d.wire.signal] ?? d.wire.signal}{d.wire.circuitLabel && d.wire.circuitLabel !== SIGNAL_LABEL[d.wire.signal] ? ` (${d.wire.circuitLabel})` : ''}</dd></div>
          </dl>
          <div className="mt-3 space-y-1">
            <div><span className="text-muted">De </span>{d.from?.name}</div>
            <div><span className="text-muted">À </span>{d.to?.name}</div>
          </div>
        </>
      )}
      {(d.kind === 'node' || d.kind === 'ground') && (
        <>
          <h3 className="text-[20px]">{d.node.name}</h3>
          {d.node.location && <p className="text-ink-2 mt-1">{d.node.location}</p>}
          {d.connector && (
            <div className="mt-3">
              <h4 className="cond text-[16px] font-semibold">Connecteur {d.connector.code} ({d.connector.cavities} voies, {d.connector.colour})</h4>
              <table className="w-full mt-1.5">
                <tbody>
                  {d.pinout.map((p: any) => (
                    <tr key={p.id} className={`list-row ${p.id === d.node.id ? 'text-instrument' : ''}`}>
                      <td className="py-1 pr-2 cond text-[17px] font-semibold w-10">{p.pinLabel}</td>
                      <td className="py-1 pr-2">{p.name.split(' — ')[1] ?? p.name}</td>
                      <td className="py-1 text-right whitespace-nowrap">{(p.wires ?? []).map((w: any, i: number) => <Swatch key={i} p={w.colourPrimary} s={w.colourStripe} />)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.consumers.length > 0 && (
            <div className="mt-3">
              <h4 className="cond text-[16px] font-semibold">{d.node.kind === 'ground' ? 'Composants reliés à cette masse' : 'Composants alimentés'}</h4>
              <ul className="mt-1 list-disc pl-5">{d.consumers.map((c: any) => <li key={c.id}>{c.ref} {c.name}</li>)}</ul>
            </div>
          )}
          {specs(d.specs)}
        </>
      )}
      {d.kind === 'component' && (
        <>
          <h3 className="text-[20px]">{d.component.ref} {d.component.name}</h3>
          <p className="text-muted">{d.component.typeName}</p>
          {d.component.location && <p className="text-ink-2 mt-2">{d.component.location}</p>}
          {d.buses.length > 0 && <p className="mt-3"><span className="text-muted">Réseau </span>{d.buses.map((b: any) => `${b.name} (${b.bitrate} kbit/s, adr. ${b.address})${b.isGateway ? ' passerelle' : ''}`).join(', ')}</p>}
          {d.supply.length > 0 && <p className="mt-1"><span className="text-muted">Alimentation / masse </span>{d.supply.map((s: any) => s.name).join(', ')}</p>}
          {d.connectors.length > 0 && <p className="mt-1"><span className="text-muted">Connecteurs </span>{d.connectors.map((c: any) => `${c.code} (${c.cavities} voies)`).join(', ')}</p>}
          {d.dtcs.length > 0 && (
            <div className="mt-3">
              <h4 className="cond text-[16px] font-semibold">Codes défaut associés</h4>
              <ul className="mt-1 space-y-1">{d.dtcs.map((x: any) => <li key={x.id}><span className="cond font-semibold mr-2">{x.code}</span><span className="text-ink-2">{x.description}</span></li>)}</ul>
              <button className="btn btn-sm mt-2" onClick={() => open('diagnostics')}>Ouvrir le diagnostic</button>
            </div>
          )}
          {specs(d.specs)}
        </>
      )}
    </div>
  );
}

export function WiringPanel() {
  const vehicle = useApp(s => s.vehicle);
  const focus = useApp(s => s.wiringFocus);
  const list = useAsync(() => (vehicle ? api.get<{ id: number; title: string }[]>(`/variants/${vehicle.id}/diagrams`) : Promise.resolve([])), [vehicle?.id]);
  const [diagramId, setDiagramId] = useState<number | null>(null);
  const meta = useAsync(() => (diagramId ? api.get<DiagramMeta>(`/diagrams/${diagramId}`) : Promise.resolve(null)), [diagramId]);
  const [sel, setSel] = useState<Selection>(null);
  const select_ = useCallback((s: Selection) => setSel(s), []);

  useEffect(() => { setDiagramId(null); setSel(null); }, [vehicle?.id]);
  useEffect(() => { if (!diagramId && list.data?.length) setDiagramId(list.data[0]!.id); }, [list.data, diagramId]);
  useEffect(() => { if (focus) setDiagramId(focus.diagramId); }, [focus]);

  if (!vehicle) return <NeedVehicle />;
  return (
    <div className="h-full flex flex-col @container">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[var(--line)]">
        <Icon name="wiring" className="text-ink-2" />
        {list.data && list.data.length > 0 ? (
          <select className="input h-[34px] max-w-[520px] flex-1" value={diagramId ?? ''} onChange={e => { setDiagramId(Number(e.target.value)); setSel(null); }} aria-label="Schéma">
            {list.data.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        ) : !list.loading && <span className="text-muted text-[14px]">Aucun schéma interactif pour ce véhicule dans la base démo (essayez la Golf VII).</span>}
        {meta.data && (
          <span className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
            {meta.data.legend.map((l, i) => <span key={i} className="whitespace-nowrap"><Swatch p={l.primary} s={l.stripe} /> {colourName(l.primary, l.stripe)}</span>)}
          </span>
        )}
      </div>
      <ErrorNote error={list.error ?? meta.error} />
      <div className="flex-1 grid grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_300px] grid-rows-[minmax(380px,1fr)_auto] @3xl:grid-rows-1 min-h-0">
        <div className="min-h-[380px]">{meta.data && <Viewer diagram={meta.data} onSelect={select_} selection={sel} />}</div>
        <aside className="border-t @3xl:border-t-0 @3xl:border-l border-[var(--line)] overflow-auto bg-[var(--bay)] max-h-[45vh] @3xl:max-h-none"><Details sel={sel} /></aside>
      </div>
    </div>
  );
}
