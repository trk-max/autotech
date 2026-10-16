'use client';
import dynamic from 'next/dynamic';

// The workspace relies on browser-only APIs (dockview, DOM measurements, localStorage).
const Workbench = dynamic(() => import('@/components/Workbench'), {
  ssr: false,
  loading: () => <div className="h-dvh grid place-items-center text-[var(--muted)]">Ouverture de l&apos;atelier…</div>,
});

export default function Page() {
  return <Workbench />;
}
