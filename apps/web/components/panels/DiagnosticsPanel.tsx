'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, type Knowledge, type NextTest, type SessionView, type TestProcedure } from '@/lib/api';
import { useApp } from '@/lib/store';
import { MEASURE_LABEL, num, pct, specRange } from '@/lib/format';
import { DemoNotice, ErrorNote, Icon, Loading, Md, NeedVehicle, Section, useAsync } from '../ui';

const MAX = 10;
const INTRUSIVENESS = ['', 'Lecture / visuel', 'Mesure au connecteur', 'Dépose légère', 'Dépose importante', 'Démontage lourd'];

function CodeInput({ variantId, onStart, busy }: { variantId: number; onStart: (codes: string[]) => void; busy: boolean }) {
  const [codes, setCodes] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const sugg = useAsync(() => api.get<{ id: number; code: string; description: string; knownForVehicle: boolean }[]>(`/variants/${variantId}/dtcs`, { q }), [variantId, q]);
  const add = (raw: string) => {
    const parts = raw.toUpperCase().split(/[\s,;]+/).map(c => c.replace(/[^A-Z0-9]/g, '')).filter(c => /^[PBCU][0-9A-F]{4}$/.test(c));
    if (!parts.length) return;
    setCodes(cur => [...new Set([...cur, ...parts])].slice(0, MAX));
    setQ('');
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--line-strong)] bg-[#11161d] px-2 py-2 min-h-[50px]">
        {codes.map(c => (
          <span key={c} className="code-chip">
            {c}
            <button aria-label={`Retirer ${c}`} className="text-muted hover:text-ink p-0.5" onClick={() => setCodes(codes.filter(x => x !== c))}><Icon name="x" size={14} /></button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[180px] bg-transparent outline-none cond text-[19px] tracking-[.06em] uppercase px-1"
          placeholder={codes.length ? 'Ajouter un code…' : 'Codes défaut : P0335, U0100…'}
          value={q} disabled={codes.length >= MAX}
          onChange={e => { const v = e.target.value; if (/[\s,;]$/.test(v)) add(v); else setQ(v); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (q) add(q); else if (codes.length) onStart(codes); }
            if (e.key === 'Backspace' && !q && codes.length) setCodes(codes.slice(0, -1));
          }}
          onPaste={e => { e.preventDefault(); add(e.clipboardData.getData('text')); }}
          aria-label="Saisie des codes défaut"
        />
        <span className="text-muted text-[13px] px-1">{codes.length}/{MAX}</span>
        <button className="btn btn-primary" disabled={!codes.length || busy} onClick={() => onStart(codes)}>
          {busy ? 'Analyse…' : 'Analyser'}
        </button>
      </div>
      {sugg.data && sugg.data.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {sugg.data.filter(s => !codes.includes(s.code)).slice(0, 8).map(s => (
            <button key={s.id} onClick={() => add(s.code)} title={s.description}
              className={`text-[13px] px-2 py-1 rounded border ${s.knownForVehicle ? 'border-[var(--line-strong)] text-ink-2' : 'border-[var(--line)] text-muted'} hover:border-[var(--instrument)] hover:text-ink`}>
              <span className="cond font-semibold text-[15px] mr-1.5">{s.code}</span>{s.description.slice(0, 46)}{s.description.length > 46 ? '…' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HvGate({ s, onDone }: { s: SessionView; onDone: (v: SessionView) => void }) {
  const [checked, setChecked] = useState<number[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const p = s.hvProcedure;
  if (!p) return <ErrorNote error="Procédure de consignation absente pour ce véhicule : tests HT impossibles." />;
  const all = checked.length === p.steps.length;
  return (
    <div className="hv-band rounded px-4 py-3 mt-4">
      <div className="flex items-center gap-3">
        <Icon name="bolt" className="text-hv" />
        <p className="flex-1 text-[15px]"><strong className="text-hv">Tests haute tension verrouillés.</strong> Effectuez et confirmez la consignation pour les débloquer.</p>
        <button className="btn btn-hv btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Masquer' : 'Consignation HT'}</button>
      </div>
      {open && (
        <div className="mt-3">
          {p.warnings.map(w => <p key={w} className="text-[13.5px] text-hv mb-1">{w}</p>)}
          <ol className="mt-2 space-y-1.5">
            {p.steps.map((step, i) => (
              <li key={i}>
                <label className="flex gap-3 items-start cursor-pointer text-[14.5px]">
                  <input type="checkbox" className="mt-1 accent-[var(--hv)] w-4 h-4" checked={checked.includes(i)}
                    onChange={e => setChecked(e.target.checked ? [...checked, i] : checked.filter(x => x !== i))} />
                  <span><span className="cond font-semibold text-hv mr-2">{i + 1}</span>{step}</span>
                </label>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex items-center gap-3">
            <button className="btn btn-hv" disabled={!all} onClick={async () => {
              setErr(null);
              try { onDone(await api.post<SessionView>(`/diagnostics/sessions/${s.id}/hv-isolation`, { confirmedSteps: checked })); } catch (e) { setErr(e); }
            }}>Je confirme la consignation</button>
            <span className="text-[13px] text-muted">{checked.length}/{p.steps.length} étapes</span>
          </div>
          <div className="mt-2"><ErrorNote error={err} /></div>
        </div>
      )}
    </div>
  );
}

function TestRunner({ s, t, onRecorded, onCancel }: { s: SessionView; t: NextTest; onRecorded: (v: SessionView) => void; onCancel: () => void }) {
  const proc = useAsync(() => api.get<TestProcedure>(`/test-procedures/${t.test.procedureId}`), [t.test.procedureId]);
  const { focusWiring, open } = useApp();
  const [values, setValues] = useState<Record<number, string>>({});
  const [oks, setOks] = useState<Record<number, boolean | undefined>>({});
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const p = proc.data;

  const verdict = (stepId: number): 'pass' | 'fail' | null => {
    const step = p?.steps.find(x => x.id === stepId);
    if (!step) return null;
    if (step.spec) {
      const raw = values[stepId];
      if (raw == null || raw.trim() === '') return null;
      const v = Number(raw.replace(',', '.'));
      if (Number.isNaN(v)) return null;
      const { min, max } = step.spec;
      return (min != null && v < min) || (max != null && v > max) ? 'fail' : 'pass';
    }
    const ok = oks[stepId];
    return ok == null ? null : ok ? 'pass' : 'fail';
  };
  const complete = p?.steps.every(st => verdict(st.id) != null) ?? false;

  const submit = async () => {
    if (!p) return;
    setBusy(true); setErr(null);
    try {
      const steps = p.steps.map(st => st.spec ? { stepId: st.id, value: Number(values[st.id]!.replace(',', '.')) } : { stepId: st.id, ok: oks[st.id]! });
      onRecorded(await api.post<SessionView>(`/diagnostics/sessions/${s.id}/results`, { causeId: t.causeId, steps }));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="rounded border border-[var(--instrument)] bg-[var(--panel-2)] p-4 mt-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="text-[21px]">{t.test.title}</h3>
        <span className="text-muted text-[14px]">{t.test.estMinutes} min · {INTRUSIVENESS[t.test.intrusiveness]}</span>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onCancel}>Fermer</button>
      </div>
      {proc.loading && <Loading />}
      <ErrorNote error={proc.error} />
      {p && (
        <>
          {p.tools.length > 0 && <p className="text-[14px] text-ink-2 mt-1">Outillage : {p.tools.join(', ')}</p>}
          <ol className="mt-4 space-y-4">
            {p.steps.map(st => {
              const v = verdict(st.id);
              const diag = st.spec ? p.diagrams.find(d => d.nodeId === st.spec!.nodeId) : undefined;
              return (
                <li key={st.id} className="grid grid-cols-[28px_1fr] gap-3">
                  <span className="cond text-[22px] font-bold text-instrument leading-none mt-0.5">{st.seq}</span>
                  <div>
                    <p className="text-[15px] text-ink-2"><Md text={st.instruction} /></p>
                    {st.spec ? (
                      <div className="mt-2 flex flex-wrap items-end gap-4">
                        <div className="text-[13.5px]">
                          <div className="text-muted">{MEASURE_LABEL[st.spec.measure] ?? st.spec.measure} · {st.spec.condition}</div>
                          <div>Entre <strong>{st.spec.node}</strong> et <strong>{st.spec.ref ?? 'la masse'}</strong></div>
                          <div className="cond text-[20px] font-semibold mt-0.5">Attendu : {specRange(st.spec.min, st.spec.max, st.spec.unit)}</div>
                        </div>
                        <label className="flex items-center gap-2">
                          <span className="sr-only">Valeur mesurée</span>
                          <input className="input input-num w-[130px]" inputMode="decimal" placeholder="mesure"
                            value={values[st.id] ?? ''} onChange={e => setValues({ ...values, [st.id]: e.target.value })} />
                          <span className="cond text-[18px] text-ink-2 w-6">{st.spec.unit}</span>
                        </label>
                        {v && <span className={`badge ${v === 'pass' ? 'badge-pass' : 'badge-fail'}`}>{v === 'pass' ? 'Conforme' : 'Hors tolérance'}</span>}
                        {diag && (
                          <button className="btn btn-sm btn-ghost" onClick={() => focusWiring(diag.id, diag.svgElementId)}>
                            <Icon name="target" size={16} /> Voir sur le schéma
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-2" role="group" aria-label={`Réponse étape ${st.seq}`}>
                        <button className={`btn btn-sm ${oks[st.id] === true ? 'border-[var(--pass)] text-pass' : ''}`} aria-pressed={oks[st.id] === true}
                          onClick={() => setOks({ ...oks, [st.id]: true })}>Oui, conforme</button>
                        <button className={`btn btn-sm ${oks[st.id] === false ? 'border-[var(--fail)] text-fail' : ''}`} aria-pressed={oks[st.id] === false}
                          onClick={() => setOks({ ...oks, [st.id]: false })}>Non</button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" disabled={!complete || busy} onClick={submit}>{busy ? 'Enregistrement…' : 'Enregistrer le résultat'}</button>
            {p.procedureRef && <button className="btn btn-ghost" onClick={() => open('procedure', { id: `procedure-${p.procedureRef}`, params: { procedureId: p.procedureRef } })}>Méthode de dépose</button>}
          </div>
          <div className="mt-2"><ErrorNote error={err} /></div>
        </>
      )}
    </div>
  );
}

function KnowledgePanel({ variantId, dtcIds }: { variantId: number; dtcIds: number[] }) {
  const k = useAsync(() => api.get<Knowledge>(`/variants/${variantId}/knowledge`, { dtcs: dtcIds.join(',') }), [variantId, dtcIds.join(',')]);
  if (k.loading) return <Loading />;
  if (k.error) return <ErrorNote error={k.error} onRetry={k.reload} />;
  const d = k.data!;
  if (!d.tsbs.length && !d.fieldCases.length) return <p className="text-muted text-[14px]">Aucune note technique ni cas terrain pour ces codes.</p>;
  return (
    <div className="space-y-3">
      {d.tsbs.map(t => (
        <article key={t.id} className="rounded border border-[var(--line)] p-3">
          <div className="flex items-center gap-2">
            <span className="badge">{t.kind === 'recall' ? 'Rappel' : t.kind === 'campaign' ? 'Campagne' : 'Note technique'}</span>
            <span className="cond text-[15px] text-muted">{t.number}</span>
          </div>
          <h4 className="cond text-[17px] font-semibold mt-1.5">{t.title}</h4>
          <p className="text-[13.5px] text-ink-2 mt-1">{t.remedy}</p>
        </article>
      ))}
      {d.fieldCases.map(f => (
        <article key={f.id} className="rounded border border-[var(--line)] p-3">
          <div className="flex items-center gap-2">
            <span className="badge">Cas terrain vérifié</span>
            <span className="text-[12.5px] text-muted">{f.confirmations} confirmation{f.confirmations > 1 ? 's' : ''}{f.mileageKm ? `, ${f.mileageKm.toLocaleString('fr-FR')} km` : ''}</span>
          </div>
          <p className="text-[13.5px] text-muted mt-1.5">{f.symptom}</p>
          <h4 className="cond text-[17px] font-semibold mt-1">{f.rootCause}</h4>
          <p className="text-[13.5px] text-ink-2 mt-1">{f.fix}</p>
        </article>
      ))}
    </div>
  );
}

function SessionScreen({ initial, onNew }: { initial: SessionView; onNew: () => void }) {
  const [s, setS] = useState(initial);
  const [active, setActive] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const activeTest = s.next.find(n => n.causeId === active) ?? null;
  const done = useMemo(() => s.candidates.filter(c => c.result), [s.candidates]);
  const dtcIds = useMemo(() => s.dtcs.map(d => d.id), [s.dtcs]);

  const close = async (causeId: string | null) => {
    setErr(null);
    try { setS(await api.post<SessionView>(`/diagnostics/sessions/${s.id}/close`, { causeId })); } catch (e) { setErr(e); }
  };

  return (
    <div className="panel-pad max-w-[1280px]">
      <div className="flex flex-wrap items-center gap-2">
        {s.dtcs.map(d => <span key={d.id} className="code-chip pr-2.5" title={d.description}>{d.code}</span>)}
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onNew}>Nouvelle analyse</button>
      </div>

      {s.confirmed && !s.closed && (
        <div className="mt-4 rounded border border-[var(--pass)] bg-[rgba(63,179,127,.08)] px-4 py-3 flex flex-wrap items-center gap-3">
          <p className="flex-1 text-[15px]"><strong className="text-pass">Cause confirmée</strong> : {s.confirmed.label} ({pct(s.confirmed.probability)})</p>
          <button className="btn btn-sm" onClick={() => close(s.confirmed!.id)}>Clôturer le diagnostic</button>
        </div>
      )}
      {s.closed && (
        <p className="mt-4 text-[14px] text-ink-2">Diagnostic clôturé le {new Date(s.closed.at).toLocaleString('fr-FR')}.</p>
      )}
      <ErrorNote error={err} />
      {s.hvRequired && !s.hvIsolated && <HvGate s={s} onDone={setS} />}
      {s.hvRequired && s.hvIsolated && <p className="mt-3 text-[14px] text-hv">Consignation HT confirmée et journalisée.</p>}

      <div className="grid grid-cols-1 @5xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] gap-8 mt-2">
        <div>
          <Section title="Ordre de test recommandé" aside={<span className="text-muted text-[13px]">probabilité / temps</span>}>
            {s.next.length === 0 && <p className="text-muted text-[14px]">Toutes les hypothèses testables ont été vérifiées.</p>}
            <ol>
              {s.next.map((n, i) => (
                <li key={n.causeId} className="list-row">
                  <button className="w-full text-left py-3 grid grid-cols-[30px_1fr_auto] gap-3 items-start disabled:opacity-60"
                    onClick={() => setActive(active === n.causeId ? null : n.causeId)} disabled={!!s.closed} aria-expanded={active === n.causeId}>
                    <span className={`cond text-[24px] font-bold leading-none ${i === 0 ? 'text-instrument' : 'text-muted'}`}>{i + 1}</span>
                    <span>
                      <span className="block text-[15.5px] font-medium text-ink">{n.label}</span>
                      <span className="block text-[13.5px] text-muted mt-0.5">
                        {n.test.title} · {n.test.estMinutes} min · explique {n.explains}/{s.dtcs.length} code{s.dtcs.length > 1 ? 's' : ''}
                      </span>
                      <span className="prob-track block mt-2 max-w-[360px]"><span className="prob-fill block" style={{ width: `${Math.max(2, n.probability * 100)}%` }} /></span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="cond text-[20px] font-semibold">{pct(n.probability)}</span>
                      {n.blockedByHv && <span className="badge badge-hv"><Icon name="bolt" size={12} />HT</span>}
                    </span>
                  </button>
                  {active === n.causeId && activeTest && (
                    n.blockedByHv
                      ? <p className="text-hv text-[14px] pb-3">Consignation HT requise avant ce test.</p>
                      : <div className="pb-4"><TestRunner key={n.causeId} s={s} t={activeTest} onRecorded={v => { setS(v); setActive(null); }} onCancel={() => setActive(null)} /></div>
                  )}
                </li>
              ))}
            </ol>
          </Section>

          {done.length > 0 && (
            <Section title="Tests réalisés">
              <ul>
                {done.map(c => (
                  <li key={c.id} className="list-row py-2.5 flex items-center gap-3">
                    <span className={`badge ${c.result === 'pass' ? 'badge-pass' : 'badge-fail'}`}>{c.result === 'pass' ? 'Conforme' : 'Défaut'}</span>
                    <span className="flex-1 text-[15px]">{c.label}</span>
                    <span className="text-[13px] text-muted">
                      {(s.stepLog[c.id] ?? []).filter(x => x.value != null).map(x => num(x.value!)).join(' / ')}
                    </span>
                    <span className="cond text-[17px] text-ink-2 w-12 text-right">{pct(c.probability)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <aside>
          <Section title="Codes saisis">
            <ul className="space-y-1.5">
              {s.dtcs.map(d => (
                <li key={d.id} className="text-[14px]"><span className="cond font-semibold text-[16px] mr-2">{d.code}</span><span className="text-ink-2">{d.description}</span></li>
              ))}
            </ul>
          </Section>
          <Section title="Notes techniques et cas terrain">
            <KnowledgePanel variantId={s.variant.id} dtcIds={dtcIds} />
          </Section>
          {s.untestable.length > 0 && (
            <Section title="Hypothèses sans test documenté">
              <ul className="text-[14px] text-ink-2 list-disc pl-5">{s.untestable.map(u => <li key={u}>{u}</li>)}</ul>
            </Section>
          )}
        </aside>
      </div>
      <DemoNotice />
    </div>
  );
}

export function DiagnosticsPanel() {
  const vehicle = useApp(s => s.vehicle);
  const [session, setSession] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => { setSession(null); setErr(null); }, [vehicle?.id]);
  if (!vehicle) return <NeedVehicle />;

  const start = async (codes: string[]) => {
    setBusy(true); setErr(null);
    try { setSession(await api.post<SessionView>('/diagnostics/sessions', { variantId: vehicle.id, codes })); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="panel-scroll @container">
      {session ? <SessionScreen key={session.id} initial={session} onNew={() => setSession(null)} /> : (
        <div className="panel-pad">
          <h1 className="text-[30px]">Diagnostic guidé multi-codes</h1>
          <p className="text-ink-2 mt-1 max-w-[66ch]">
            Saisissez jusqu&apos;à {MAX} codes relevés à l&apos;outil de diagnostic. L&apos;analyse croise les codes avec la topologie
            réseau et les alimentations du véhicule pour proposer les tests les plus rentables en premier.
          </p>
          <div className="mt-5 max-w-[900px]"><CodeInput variantId={vehicle.id} onStart={start} busy={busy} /></div>
          <div className="mt-3 max-w-[900px]"><ErrorNote error={err} /></div>
          <p className="text-muted text-[13px] mt-4">
            Scénarios démo : Golf 2.0 TDI <span className="cond font-semibold">U0100 U0101 P0562</span> ou <span className="cond font-semibold">P0335</span>,
            Clio <span className="cond font-semibold">P0087</span>, Yaris Hybrid <span className="cond font-semibold">P0A80 P0AA6</span>.
          </p>
        </div>
      )}
    </div>
  );
}
