'use client';
import { useEffect, useState } from 'react';
import { api, type MaintenanceItem } from '@/lib/api';
import { useApp } from '@/lib/store';
import { hours, km } from '@/lib/format';
import { DemoNotice, ErrorNote, Icon, Loading, NeedVehicle, Section } from '../ui';

const BADGE: Record<MaintenanceItem['status'], string> = { overdue: 'badge-fail', due: 'badge-due', upcoming: '', ok: 'badge-pass' };

function monthsSince(date: string): number | null {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
}

export function MaintenancePanel() {
  const vehicle = useApp(s => s.vehicle);
  const presetLabor = useApp(s => s.presetLabor);
  const [mileage, setMileage] = useState('89500');
  const [firstReg, setFirstReg] = useState('2020-06-15');
  const [plate, setPlate] = useState('');
  const [items, setItems] = useState<MaintenanceItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const kmN = Number(mileage.replace(/\s/g, ''));
  const age = monthsSince(firstReg);
  const valid = Number.isFinite(kmN) && kmN >= 0 && age != null;

  useEffect(() => {
    if (!vehicle || !valid) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.get<{ items: MaintenanceItem[] }>(`/variants/${vehicle.id}/maintenance`, { km: kmN, ageMonths: age })
        .then(r => { if (!cancelled) { setItems(r.items); setErr(null); } })
        .catch(e => { if (!cancelled) setErr(e); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [vehicle, kmN, age, valid]);

  if (!vehicle) return <NeedVehicle />;
  const due = (items ?? []).filter(i => i.status === 'overdue' || i.status === 'due');
  const dueOps = due.map(i => i.operationId).filter((x): x is number => x != null);
  const pdfUrl = `/api/variants/${vehicle.id}/maintenance/checklist.pdf?` + new URLSearchParams({ km: String(kmN), ageMonths: String(age ?? 0), ...(plate ? { plate } : {}) });

  return (
    <div className="panel-scroll">
      <div className="panel-pad">
        <h1 className="text-[30px]">Plan d&apos;entretien</h1>
        <div className="flex flex-wrap gap-4 mt-4 items-end">
          <label className="flex flex-col gap-1"><span className="label">Kilométrage</span>
            <input className="input input-num w-[160px]" inputMode="numeric" value={mileage} onChange={e => setMileage(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1"><span className="label">1re mise en circulation</span>
            <input type="date" className="input" value={firstReg} onChange={e => setFirstReg(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1"><span className="label">Immatriculation (facultatif)</span>
            <input className="input w-[170px]" value={plate} onChange={e => setPlate(e.target.value)} placeholder="123 TU 4567" maxLength={20} />
          </label>
          {age != null && <span className="text-muted text-[14px] pb-2">Âge : {age} mois</span>}
        </div>
        <div className="mt-3"><ErrorNote error={err} /></div>

        <Section title="Opérations" aside={
          <div className="flex gap-2">
            <button className="btn btn-sm" disabled={!dueOps.length} onClick={() => presetLabor(dueOps)}>Chiffrer les opérations à faire</button>
            <a className="btn btn-sm" href={pdfUrl} target="_blank" rel="noopener"><Icon name="pdf" size={16} />Fiche d&apos;entretien</a>
          </div>
        }>
          {loading && !items && <Loading />}
          <table className="w-full text-[14.5px]">
            <thead><tr className="text-left text-muted text-[13px]">
              <th className="font-medium pb-1.5">Opération</th><th className="font-medium pb-1.5">Intervalle</th><th className="font-medium pb-1.5">Prochaine échéance</th><th className="font-medium pb-1.5">Temps</th><th className="font-medium pb-1.5 text-right">État</th>
            </tr></thead>
            <tbody>
              {(items ?? []).map(i => (
                <tr key={i.id} className="list-row">
                  <td className="py-2.5 pr-3">{i.task}</td>
                  <td className="py-2.5 pr-3 text-ink-2">{[i.intervalKm ? km(i.intervalKm) : null, i.intervalMonths ? `${i.intervalMonths} mois` : null].filter(Boolean).join(' ou ')}</td>
                  <td className="py-2.5 pr-3 text-ink-2">
                    {[i.nextKm != null ? km(i.nextKm) : null, i.nextAgeMonths != null ? `${i.nextAgeMonths} mois` : null].filter(Boolean).join(' / ')}
                    {i.remainingKm != null && i.remainingKm < 0 && <span className="text-fail"> (dépassé de {km(-i.remainingKm)})</span>}
                  </td>
                  <td className="py-2.5 pr-3 cond text-[16px]">{i.oemHours != null ? hours(i.oemHours) : '—'}</td>
                  <td className="py-2.5 text-right"><span className={`badge ${BADGE[i.status]}`}>{i.statusLabel}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted text-[13px] mt-3">Échéance au premier des deux termes atteint (kilométrage ou durée). Sans historique saisi, le calcul suit le plan théorique.</p>
        </Section>
        <DemoNotice />
      </div>
    </div>
  );
}
