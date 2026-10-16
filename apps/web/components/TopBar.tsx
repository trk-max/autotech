'use client';
import { useEffect, useRef, useState } from 'react';
import { api, type SearchResult, type Variant } from '@/lib/api';
import { useApp } from '@/lib/store';
import { vehicleLines } from '@/lib/format';
import { Icon } from './ui';

function OmniSearch() {
  const { setVehicle, open, vehicle } = useApp();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [show, setShow] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    let cancelled = false;
    const t = setTimeout(() => api.get<SearchResult>('/search', { q }).then(r => !cancelled && setRes(r)).catch(() => !cancelled && setRes(null)), 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setShow(false); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); box.current?.querySelector('input')?.focus(); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  const pick = (v: Variant) => { setVehicle(v); setShow(false); setQ(''); open('vehicle'); };
  const vehicles = res?.kind === 'vin' ? res.decode?.candidates ?? [] : res?.vehicles ?? [];

  return (
    <div ref={box} className="relative flex-1 max-w-[640px]">
      <div className="flex items-center gap-2 h-[38px] px-3 rounded border border-[var(--line-strong)] bg-[#11161d] focus-within:border-[var(--instrument)]">
        <Icon name="search" size={18} className="text-muted" />
        <input className="flex-1 bg-transparent outline-none text-[15px]" placeholder="VIN, véhicule (golf 7 tdi) ou code défaut"
          value={q} onChange={e => { setQ(e.target.value); setShow(true); }} onFocus={() => setShow(true)}
          onKeyDown={e => { if (e.key === 'Enter' && vehicles[0]) pick(vehicles[0]); if (e.key === 'Escape') setShow(false); }}
          aria-label="Recherche" aria-expanded={show && !!res} role="combobox" aria-controls="omni-results" />
        <kbd className="text-[11px] text-muted border border-[var(--line)] rounded px-1.5 py-0.5 hidden md:inline">Ctrl K</kbd>
      </div>
      {show && res && (res.kind !== 'empty') && (
        <div id="omni-results" className="absolute z-50 left-0 right-0 mt-1 rounded border border-[var(--line-strong)] bg-[var(--panel)] shadow-[0_14px_40px_rgba(0,0,0,.5)] max-h-[70vh] overflow-auto">
          {res.kind === 'vin' && res.decode && (
            <div className="px-3 py-2 border-b border-[var(--line)] text-[13.5px]">
              <span className={res.decode.valid ? 'text-pass' : 'text-fail'}>{res.decode.valid ? 'VIN valide' : 'VIN invalide'}</span>
              {res.decode.manufacturer && <span className="text-ink-2"> · {res.decode.manufacturer}</span>}
              {res.decode.errors.map(e => <div key={e} className="text-fail">{e}</div>)}
              {res.decode.needsDisambiguation && <div className="text-muted">Plusieurs motorisations : choisissez.</div>}
            </div>
          )}
          {vehicles.map(v => {
            const l = vehicleLines(v);
            return (
              <button key={v.id} onClick={() => pick(v)} className="w-full text-left px-3 py-2.5 hover:bg-[var(--panel-2)] flex items-center gap-3 border-b border-[var(--line)]">
                <Icon name="car" size={18} className="text-muted" />
                <span className="flex-1"><span className="font-medium">{l.title}</span> <span className="text-ink-2">{l.engine}, {l.gearbox}, {l.power}</span></span>
                <span className="text-muted text-[13px]">{l.years}</span>
              </button>
            );
          })}
          {res.dtcs.map(d => (
            <button key={d.id} onClick={() => { setShow(false); open('diagnostics'); }} disabled={!vehicle}
              className="w-full text-left px-3 py-2.5 hover:bg-[var(--panel-2)] flex items-center gap-3 border-b border-[var(--line)] disabled:opacity-60">
              <Icon name="diag" size={18} className="text-muted" />
              <span className="cond font-semibold text-[16px]">{d.code}</span><span className="text-ink-2 text-[14px] flex-1">{d.description}</span>
            </button>
          ))}
          {!vehicles.length && !res.dtcs.length && res.kind !== 'vin' && <p className="px-3 py-3 text-muted text-[14px]">Aucun résultat.</p>}
        </div>
      )}
    </div>
  );
}

function VehicleChip() {
  const { vehicle, open } = useApp();
  if (!vehicle) return <button className="btn btn-ghost btn-sm" onClick={() => open('vehicle')}>Aucun véhicule</button>;
  const l = vehicleLines(vehicle);
  return (
    <button onClick={() => open('vehicle')} className="flex items-center gap-3 h-[38px] px-3 rounded border border-[var(--line)] hover:border-[var(--ink-2)] max-w-[460px]">
      <Icon name="car" size={18} className="text-instrument shrink-0" />
      <span className="truncate text-[14px]"><span className="font-semibold">{l.title}</span> <span className="text-ink-2">{l.engine}</span></span>
      {vehicle.hv !== 'none' && <span className="badge badge-hv shrink-0">HT</span>}
    </button>
  );
}

export function TopBar() {
  return (
    <header className="flex items-center gap-4 px-4 h-[56px] border-b border-[var(--line)] bg-[var(--bay)]">
      <div className="flex items-center gap-2 shrink-0" aria-label="AutoTech Knowledge Hub">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden><rect x="1" y="1" width="24" height="24" rx="5" fill="none" stroke="var(--instrument)" strokeWidth="2" /><path d="M6 15h4l2-6 3 10 2-4h3" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>
        <span className="cond text-[21px] font-bold tracking-[.02em] hidden sm:inline">AutoTech</span>
      </div>
      <OmniSearch />
      <div className="ml-auto"><VehicleChip /></div>
    </header>
  );
}
