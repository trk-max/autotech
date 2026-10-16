'use client';
import { api, type ProcedureDetail, type ProcedureSummary } from '@/lib/api';
import { useApp } from '@/lib/store';
import { DemoNotice, ErrorNote, Icon, Loading, Md, NeedVehicle, useAsync } from '../ui';

const KIND: Record<string, string> = {
  r_and_r: 'Dépose / repose', removal: 'Dépose', installation: 'Repose', adjustment: 'Réglage', body_sectioning: 'Carrosserie',
  body_dimensions: 'Cotes carrosserie', hv_deactivation: 'Sécurité haute tension', adas_calibration: 'Calibrage ADAS', service_reset: 'Remise à zéro', maintenance_task: 'Entretien',
};

function stages(s: { nm?: number; deg?: number }[]) {
  return s.map((x, i) => (x.nm != null ? `${i ? 'puis ' : ''}${x.nm} N·m` : `${i ? 'puis ' : ''}+${x.deg}°`)).join(', ');
}

export function ProcedureView({ procedureId }: { procedureId: number }) {
  const q = useAsync(() => api.get<ProcedureDetail>(`/procedures/${procedureId}`), [procedureId]);
  if (q.loading) return <div className="panel-pad"><Loading /></div>;
  if (q.error) return <div className="panel-pad"><ErrorNote error={q.error} onRetry={q.reload} /></div>;
  const p = q.data!;
  const hv = p.kind === 'hv_deactivation';
  return (
    <div className="panel-scroll">
      <div className="panel-pad max-w-[900px]">
        <span className={`badge ${hv ? 'badge-hv' : ''}`}>{hv && <Icon name="bolt" size={12} />}{KIND[p.kind] ?? p.kind}</span>
        <h1 className="text-[30px] mt-2">{p.title}</h1>
        {(p.body.warnings ?? []).length > 0 && (
          <div className={`${hv ? 'hv-band' : 'border border-[var(--instrument)]'} rounded px-4 py-3 mt-4 space-y-1`}>
            {p.body.warnings!.map(w => <p key={w} className="text-[14.5px]"><strong className={hv ? 'text-hv' : 'text-instrument'}>Attention.</strong> {w}</p>)}
          </div>
        )}
        <ol className="mt-5 space-y-3">
          {p.body.steps.map((s, i) => (
            <li key={i} className="grid grid-cols-[32px_1fr] gap-3">
              <span className={`cond text-[22px] font-bold leading-none ${hv ? 'text-hv' : 'text-instrument'}`}>{i + 1}</span>
              <span className="text-[15.5px] text-ink-2"><Md text={s} /></span>
            </li>
          ))}
        </ol>
        {(p.body.tools ?? []).length > 0 && (
          <div className="mt-6"><h2 className="text-[19px]">Outillage spécifique</h2>
            <ul className="mt-1.5 list-disc pl-5 text-[14.5px] text-ink-2">{p.body.tools!.map(t => <li key={t}>{t}</li>)}</ul></div>
        )}
        {p.torque.length > 0 && (
          <div className="mt-6">
            <h2 className="text-[19px]">Couples de serrage</h2>
            <table className="w-full mt-2 text-[14.5px]">
              <tbody>
                {p.torque.map(t => (
                  <tr key={t.id} className="list-row">
                    <td className="py-2 pr-3">{t.fastener}</td>
                    <td className="py-2 pr-3 cond text-[19px] font-semibold whitespace-nowrap">{stages(t.stages)}</td>
                    <td className="py-2 text-right">{t.replaceFastener && <span className="badge badge-due">Vis à remplacer</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted text-[13px] mt-6">Source : {p.sourceName} · version {p.version}</p>
        <DemoNotice />
      </div>
    </div>
  );
}

export function ProceduresPanel() {
  const vehicle = useApp(s => s.vehicle);
  const open = useApp(s => s.open);
  const list = useAsync(() => (vehicle ? api.get<ProcedureSummary[]>(`/variants/${vehicle.id}/procedures`) : Promise.resolve([])), [vehicle?.id]);
  if (!vehicle) return <NeedVehicle />;
  return (
    <div className="panel-scroll">
      <div className="panel-pad max-w-[900px]">
        <h1 className="text-[30px]">Méthodes de réparation</h1>
        <ErrorNote error={list.error} onRetry={list.reload} />
        {list.loading && <Loading />}
        <ul className="mt-4">
          {(list.data ?? []).map(p => (
            <li key={p.id} className="list-row">
              <button className="w-full text-left py-3 flex items-center gap-4 hover:text-instrument"
                onClick={() => open('procedure', { id: `procedure-${p.id}`, title: p.title.split(' — ')[0], params: { procedureId: p.id } })}>
                <span className={`badge ${p.kind === 'hv_deactivation' ? 'badge-hv' : ''} min-w-[150px] justify-center`}>{KIND[p.kind] ?? p.kind}</span>
                <span className="flex-1 text-[15.5px]">{p.title}</span>
                {p.torqueCount > 0 && <span className="text-muted text-[13px]">{p.torqueCount} couples</span>}
              </button>
            </li>
          ))}
          {list.data?.length === 0 && <li className="text-muted text-[14px]">Aucune méthode pour ce véhicule dans la base démo.</li>}
        </ul>
      </div>
    </div>
  );
}
