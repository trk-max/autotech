'use client';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Minimal markdown: **bold** only (procedure and test texts). */
export function Md({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span className="md">
      {parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>))}
    </span>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-3 rounded border border-[var(--fail)] bg-[rgba(240,84,92,.08)] px-3 py-2 text-[14px]">
      <span className="text-fail font-semibold">Erreur</span>
      <span className="text-ink-2 flex-1">{msg}</span>
      {onRetry && <button className="btn btn-sm btn-ghost" onClick={onRetry}>Réessayer</button>}
    </div>
  );
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return <div className="text-muted text-[14px] py-6" aria-live="polite">{label}</div>;
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-7">
      <div className="flex items-baseline justify-between gap-4 mb-2.5">
        <h2 className="text-[19px] text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    fn().then(d => { if (n === seq.current) setData(d); })
      .catch(e => { if (n === seq.current) setError(e); })
      .finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

/** Line icons drawn for this app (24×24, stroke = currentColor). */
const PATHS: Record<string, ReactNode> = {
  car: <><path d="M4 15l1.6-5.2A2 2 0 0 1 7.5 8.4h9a2 2 0 0 1 1.9 1.4L20 15" /><rect x="3" y="15" width="18" height="4" rx="1" /><circle cx="7.5" cy="19.5" r="1.5" /><circle cx="16.5" cy="19.5" r="1.5" /></>,
  diag: <><path d="M3 12h4l2-6 4 12 2-6h6" /></>,
  wiring: <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 6h6v12h4" /><path d="M13 12h-4" /><circle cx="7.5" cy="12" r="1.5" /></>,
  labor: <><path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.4 2.4-2.6-.6-.6-2.6z" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="1.5" /><path d="M4 10h16M9 3v4M15 3v4" /><path d="M9 14l2 2 4-4" /></>,
  book: <><path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h9" /></>,
  bolt: <><path d="M13 3L5 14h6l-1 7 8-11h-6z" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  x: <><path d="M6 6l12 12M18 6L6 18" /></>,
  pdf: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 13h5M10 17h5" /></>,
  target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
};

export function Icon({ name, size = 20, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {PATHS[name]}
    </svg>
  );
}

export function DemoNotice() {
  return (
    <p className="text-[12.5px] text-muted mt-10 max-w-[70ch]">
      Données de démonstration synthétiques : valeurs, temps et couples non constructeur. À remplacer par des données sous licence avant tout usage en atelier.
    </p>
  );
}

export function NeedVehicle() {
  return <div className="panel-pad text-ink-2">Identifiez d&apos;abord un véhicule (VIN, recherche ou arborescence) dans l&apos;onglet Véhicule.</div>;
}
