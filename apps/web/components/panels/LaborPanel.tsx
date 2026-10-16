'use client';
import { useEffect, useState } from 'react';
import { api, type LaborOp, type QuotePreview } from '@/lib/api';
import { useApp } from '@/lib/store';
import { hours } from '@/lib/format';
import { DemoNotice, ErrorNote, Icon, Loading, NeedVehicle, Section, useAsync } from '../ui';

const SYSTEM_LABEL: Record<string, string> = {
  engine: 'Moteur', chassis: 'Châssis', hvac: 'Climatisation', electrical: 'Électricité', hybrid: 'Hybride', transmission: 'Transmission',
};

function parseRate(s: string): number | null {
  const v = Number(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 1000) : null;
}

export function LaborPanel() {
  const vehicle = useApp(s => s.vehicle);
  const preset = useApp(s => s.laborPreset);
  const ops = useAsync(() => (vehicle ? api.get<LaborOp[]>(`/variants/${vehicle.id}/labor-operations`) : Promise.resolve([])), [vehicle?.id]);
  const [selected, setSelected] = useState<number[]>([]);
  const [rate, setRate] = useState('45,000');
  const [customer, setCustomer] = useState('');
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [saved, setSaved] = useState<{ id: string; pdfUrl: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setSelected([]); setPreview(null); setSaved(null); }, [vehicle?.id]);
  useEffect(() => { if (preset) { setSelected(preset.operationIds); setSaved(null); } }, [preset]);

  const rateM = parseRate(rate);
  useEffect(() => {
    if (!vehicle || !selected.length || rateM == null) { setPreview(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.post<QuotePreview>('/quotes/preview', { variantId: vehicle.id, operationIds: selected, hourlyRateMillimes: rateM })
        .then(p => { if (!cancelled) { setPreview(p); setErr(null); } })
        .catch(e => { if (!cancelled) setErr(e); });
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [vehicle, selected, rateM]);

  if (!vehicle) return <NeedVehicle />;

  const groups = new Map<string, LaborOp[]>();
  for (const o of ops.data ?? []) {
    const g = SYSTEM_LABEL[o.system.split('.')[0]!] ?? o.system;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }
  const toggle = (id: number) => { setSaved(null); setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id])); };

  const save = async () => {
    if (rateM == null) return;
    setSaving(true); setErr(null);
    try {
      const q = await api.post<{ id: string; pdfUrl: string }>('/quotes', { variantId: vehicle.id, operationIds: selected, hourlyRateMillimes: rateM, customerName: customer || null });
      setSaved(q);
      window.open(q.pdfUrl, '_blank', 'noopener');
    } catch (e) { setErr(e); } finally { setSaving(false); }
  };

  return (
    <div className="panel-scroll @container">
      <div className="panel-pad max-w-[1280px]">
        <h1 className="text-[30px]">Temps barémés et devis</h1>
        <p className="text-ink-2 mt-1 max-w-[68ch]">
          Cochez plusieurs travaux : les étapes de dépose communes ne sont facturées qu&apos;une fois (accès distribution, roues, cache moteur…).
        </p>
        <ErrorNote error={ops.error} onRetry={ops.reload} />
        {ops.loading && <Loading />}

        <div className="grid grid-cols-1 @4xl:grid-cols-[minmax(0,1fr)_minmax(360px,1.1fr)] gap-8">
          <div>
            {[...groups].map(([g, list]) => (
              <Section key={g} title={g}>
                <ul>
                  {list.map(o => (
                    <li key={o.id} className="list-row">
                      <label className="flex items-center gap-3 py-2.5 cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 accent-[var(--instrument)]" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                        <span className="flex-1 text-[15px]">{o.name}</span>
                        <span className="cond text-[18px] font-semibold text-ink-2">{hours(o.oemHours)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Section>
            ))}
          </div>

          <div className="@4xl:sticky @4xl:top-4 self-start">
            <Section title="Devis">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1"><span className="label">Taux horaire (DT HT)</span>
                  <input className="input input-num" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} aria-invalid={rateM == null} />
                </label>
                <label className="flex flex-col gap-1"><span className="label">Client (facultatif)</span>
                  <input className="input" value={customer} onChange={e => setCustomer(e.target.value)} maxLength={120} />
                </label>
              </div>
              {!selected.length && <p className="text-muted text-[14px] mt-4">Sélectionnez au moins une opération.</p>}
              <div className="mt-3"><ErrorNote error={err} /></div>
              {preview && selected.length > 0 && (
                <div className="mt-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded border border-[var(--line)] p-3"><div className="label">Temps constructeur</div><div className="cond text-[26px] font-semibold">{hours(preview.grossHours)}</div></div>
                    <div className="rounded border border-[var(--line)] p-3"><div className="label">Temps facturé</div><div className="cond text-[26px] font-semibold">{hours(preview.netHours)}</div></div>
                    <div className={`rounded border p-3 ${preview.savedHours > 0 ? 'border-[var(--pass)]' : 'border-[var(--line)]'}`}>
                      <div className="label">Recouvrement</div><div className={`cond text-[26px] font-semibold ${preview.savedHours > 0 ? 'text-pass' : ''}`}>− {hours(preview.savedHours)}</div>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between mt-4 px-1">
                    <span className="text-ink-2">Total main-d&apos;œuvre HT</span>
                    <span className="cond text-[34px] font-bold text-instrument">{preview.totalFormatted}</span>
                  </div>
                  {preview.savedMillimes > 0 && <p className="text-right text-[13.5px] text-pass px-1">Économie client : {preview.savedFormatted}</p>}
                  {preview.method === 'oem_rules' && <p className="text-[13.5px] text-muted mt-2">Déduction issue de la table de recouvrement constructeur.</p>}
                  {preview.warnings.map(w => <p key={w} className="text-[13px] text-hv mt-1">{w}</p>)}

                  {preview.lines.length > 0 && (
                    <table className="w-full mt-4 text-[14px]">
                      <thead><tr className="text-left text-muted text-[13px]"><th className="font-medium pb-1">Étape</th><th className="font-medium pb-1">Utilisée par</th><th className="font-medium pb-1 text-right">Temps</th></tr></thead>
                      <tbody>
                        {preview.lines.map(l => (
                          <tr key={l.stepId} className="list-row">
                            <td className="py-1.5 pr-2">{l.name}{!l.isAccess && <span className="text-muted"> (travail)</span>}</td>
                            <td className={`py-1.5 pr-2 text-[13px] ${l.sharedBy.length > 1 ? 'text-pass' : 'text-muted'}`}>
                              {l.sharedBy.length > 1 ? `Partagée par ${l.sharedBy.length} travaux` : '—'}
                            </td>
                            <td className="py-1.5 text-right cond text-[16px]">{hours(l.hours)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="flex flex-wrap items-center gap-3 mt-5">
                    <button className="btn btn-primary" onClick={save} disabled={saving || rateM == null}>
                      <Icon name="pdf" size={18} /> {saving ? 'Création…' : 'Enregistrer et imprimer le devis'}
                    </button>
                    {saved && <a className="text-[14px]" href={saved.pdfUrl} target="_blank" rel="noopener">Rouvrir le PDF (n° {saved.id.slice(0, 8).toUpperCase()})</a>}
                  </div>
                </div>
              )}
            </Section>
          </div>
        </div>
        <DemoNotice />
      </div>
    </div>
  );
}
