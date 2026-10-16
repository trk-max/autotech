'use client';
import { useState } from 'react';
import { api, type TreeMake, type Variant, type VariantDetail, type VinDecode } from '@/lib/api';
import { useApp } from '@/lib/store';
import { vehicleLines } from '@/lib/format';
import { DemoNotice, ErrorNote, Icon, Loading, Section, useAsync } from '../ui';

export function VariantButton({ v, onPick }: { v: Variant; onPick: (v: Variant) => void }) {
  const l = vehicleLines(v);
  return (
    <button
      onClick={() => onPick(v)}
      className="w-full text-left px-4 py-3 rounded border border-[var(--line)] hover:border-[var(--instrument)] bg-[var(--panel-2)] flex items-center gap-4"
    >
      <span className="cond text-[20px] font-semibold min-w-[150px]">{l.engine}</span>
      <span className="flex-1 grid grid-cols-3 gap-2 text-[14px] text-ink-2">
        <span>{l.gearbox}</span><span>{l.power}</span><span>{l.years}</span>
      </span>
      {v.hv !== 'none' && <span className="badge badge-hv">HT {v.hvVoltage} V</span>}
    </button>
  );
}

export function VinResult({ d, onPick }: { d: VinDecode; onPick: (v: Variant) => void }) {
  return (
    <div className="mt-4 rounded border border-[var(--line)] p-4 bg-[var(--panel-2)]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="cond text-[22px] font-semibold tracking-[.08em]">
          <span className="text-instrument">{d.wmi}</span>{d.vds}<span className="text-ink-2">{d.vis}</span>
        </span>
        <span className={`badge ${d.valid ? 'badge-pass' : 'badge-fail'}`}>{d.valid ? 'VIN valide' : 'VIN invalide'}</span>
        {d.manufacturer && <span className="text-ink-2">{d.manufacturer}</span>}
        {d.modelYearCandidates.length > 0 && <span className="text-muted text-[14px]">Année modèle possible : {d.modelYearCandidates.join(' ou ')}</span>}
      </div>
      <dl className="grid grid-cols-3 gap-3 mt-3 text-[13px] max-w-[520px]">
        <div><dt className="text-muted">WMI (1-3)</dt><dd className="cond text-[17px]">{d.wmi || '—'}</dd></div>
        <div><dt className="text-muted">VDS (4-9)</dt><dd className="cond text-[17px]">{d.vds || '—'}</dd></div>
        <div><dt className="text-muted">VIS (10-17)</dt><dd className="cond text-[17px]">{d.vis || '—'}</dd></div>
      </dl>
      {d.errors.map(e => <p key={e} className="text-fail text-[14px] mt-2">{e}</p>)}
      {d.warnings.map(w => <p key={w} className="text-muted text-[13px] mt-1">{w}</p>)}
      {d.candidates.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[14px] text-ink-2">
            {d.needsDisambiguation ? `${d.candidates.length} motorisations possibles pour ce VIN : choisissez celle du véhicule (plaque moteur, carte grise).` : 'Véhicule identifié :'}
          </p>
          {d.candidates.map(v => <VariantButton key={v.id} v={v} onPick={onPick} />)}
        </div>
      )}
    </div>
  );
}

function Identify() {
  const setVehicle = useApp(s => s.setVehicle);
  const [vin, setVin] = useState('');
  const [decode, setDecode] = useState<VinDecode | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const tree = useAsync(() => api.get<TreeMake[]>('/vehicles/tree'), []);
  const [make, setMake] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [gen, setGen] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try { setDecode(await api.get<VinDecode>(`/vehicles/vin/${encodeURIComponent(vin)}`)); } catch (x) { setErr(x); }
  };

  const mk = tree.data?.find(m => m.make === make);
  const md = mk?.models.find(m => m.model === model);
  const gn = md?.generations.find(g => g.generation === gen);

  const col = (items: string[], current: string | null, pick: (s: string) => void) => (
    <ul className="min-w-[170px] border-r border-[var(--line)] pr-2">
      {items.map(i => (
        <li key={i}>
          <button onClick={() => pick(i)} aria-pressed={current === i}
            className={`w-full text-left px-3 py-2 rounded text-[15px] ${current === i ? 'bg-[var(--panel-2)] text-ink shadow-[inset_2px_0_0_var(--instrument)]' : 'text-ink-2 hover:text-ink'}`}>
            {i}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="panel-pad">
      <h1 className="text-[30px]">Identifier le véhicule</h1>
      <p className="text-ink-2 mt-1 max-w-[62ch]">Par le numéro VIN (case E de la carte grise) ou par l&apos;arborescence constructeur.</p>

      <form onSubmit={submit} className="mt-5 flex gap-2 max-w-[620px]">
        <input className="input flex-1 cond tracking-[.12em] text-[19px] uppercase" placeholder="VIN — 17 caractères" maxLength={24}
          value={vin} onChange={e => setVin(e.target.value)} aria-label="Numéro VIN" />
        <button className="btn btn-primary" disabled={vin.trim().length < 11}>Décoder</button>
      </form>
      <p className="text-muted text-[13px] mt-2">
        Exemples démo : <button className="underline decoration-dotted" onClick={() => setVin('WVWZZZAUZFW123456')}>WVWZZZAUZFW123456</button>,{' '}
        <button className="underline decoration-dotted" onClick={() => setVin('VF15RBF0A49123456')}>VF15RBF0A49123456</button>,{' '}
        <button className="underline decoration-dotted" onClick={() => setVin('VNKKD3D30JA123456')}>VNKKD3D30JA123456</button>
      </p>
      <div className="mt-3 max-w-[820px]"><ErrorNote error={err} /></div>
      {decode && <div className="max-w-[820px]"><VinResult d={decode} onPick={setVehicle} /></div>}

      <Section title="Arborescence constructeur">
        {tree.loading && <Loading />}
        <ErrorNote error={tree.error} onRetry={tree.reload} />
        {tree.data && (
          <div className="flex gap-2 items-start overflow-x-auto pb-2">
            {col(tree.data.map(m => m.make), make, m => { setMake(m); setModel(null); setGen(null); })}
            {mk && col(mk.models.map(m => m.model), model, m => { setModel(m); setGen(null); })}
            {md && col(md.generations.map(g => g.generation), gen, setGen)}
            {gn && (
              <div className="flex-1 min-w-[420px] space-y-2 pl-1">
                {gn.variants.map(v => <VariantButton key={v.id} v={v} onPick={setVehicle} />)}
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function Summary({ vehicle }: { vehicle: Variant }) {
  const { setVehicle, open } = useApp();
  const detail = useAsync(() => api.get<VariantDetail>(`/variants/${vehicle.id}`), [vehicle.id]);
  const l = vehicleLines(vehicle);
  const d = detail.data;
  const modules: { kind: 'diagnostics' | 'wiring' | 'maintenance' | 'labor' | 'procedures'; icon: string; label: string; count?: number; unit?: string }[] = [
    { kind: 'diagnostics', icon: 'diag', label: 'Diagnostic guidé', count: d?.counts.dtcs, unit: 'codes documentés' },
    { kind: 'wiring', icon: 'wiring', label: 'Schémas électriques', count: d?.counts.diagrams, unit: 'schémas' },
    { kind: 'maintenance', icon: 'calendar', label: 'Entretien', unit: 'plan constructeur' },
    { kind: 'labor', icon: 'labor', label: 'Temps & devis', count: d?.counts.laborOperations, unit: 'opérations' },
    { kind: 'procedures', icon: 'book', label: 'Méthodes & couples', count: d?.counts.procedures, unit: 'méthodes' },
  ];
  return (
    <div className="panel-pad">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[34px] leading-none">{l.title}</h1>
          <div className="flex flex-wrap gap-x-7 gap-y-1 mt-3 text-[15px]">
            <span><span className="text-muted">Moteur </span><span className="cond text-[19px] font-semibold">{l.engine}</span></span>
            <span><span className="text-muted">Boîte </span><span className="cond text-[19px] font-semibold">{l.gearbox}</span></span>
            <span><span className="text-muted">Puissance </span><span className="cond text-[19px] font-semibold">{l.power}</span></span>
            <span><span className="text-muted">Production </span><span className="cond text-[19px] font-semibold">{l.years}</span></span>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={() => setVehicle(null)}>Changer de véhicule</button>
      </div>

      {vehicle.hv !== 'none' && (
        <div className="hv-band mt-5 rounded px-4 py-3 flex items-center gap-3">
          <Icon name="bolt" className="text-hv" />
          <p className="text-[15px]">
            <strong className="text-hv">Véhicule haute tension ({vehicle.hvVoltage} V).</strong>{' '}
            Toute intervention sur le circuit HT exige la consignation et une habilitation adaptée.
          </p>
          <button className="btn btn-hv btn-sm ml-auto" onClick={() => open('procedures')}>Procédure de consignation</button>
        </div>
      )}

      <ErrorNote error={detail.error} onRetry={detail.reload} />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3 mt-6">
        {modules.map(m => (
          <button key={m.kind} onClick={() => open(m.kind)}
            className="text-left rounded border border-[var(--line)] bg-[var(--panel-2)] hover:border-[var(--instrument)] px-4 py-3.5 group">
            <Icon name={m.icon} className="text-ink-2 group-hover:text-instrument" />
            <div className="cond text-[19px] font-semibold mt-2">{m.label}</div>
            <div className="text-muted text-[13px]">{m.count != null ? `${m.count} ${m.count > 1 ? m.unit : m.unit!.replace(/s\b/g, '')}` : m.unit}</div>
          </button>
        ))}
      </div>

      <Section title="Ingrédients et capacités">
        {detail.loading && <Loading />}
        {d && (
          <table className="w-full max-w-[760px] text-[14.5px]">
            <tbody>
              {d.fluids.map(f => (
                <tr key={f.system} className="list-row">
                  <td className="py-2 pr-4 text-ink-2">{f.system}</td>
                  <td className="py-2 pr-4 cond text-[18px] font-semibold whitespace-nowrap">{f.capacity != null ? `${String(f.capacity).replace('.', ',')} ${f.unit}` : '—'}</td>
                  <td className="py-2 pr-4">{f.specification}</td>
                  <td className="py-2 text-ink-2">{f.viscosity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <DemoNotice />
    </div>
  );
}

export function VehiclePanel() {
  const vehicle = useApp(s => s.vehicle);
  return <div className="panel-scroll">{vehicle ? <Summary vehicle={vehicle} /> : <Identify />}</div>;
}
