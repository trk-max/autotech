'use client';
import { useEffect } from 'react';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview';
import { useApp, restoreVehicle, PANEL_TITLES, type PanelKind } from '@/lib/store';
import { TopBar } from './TopBar';
import { Icon } from './ui';
import { VehiclePanel } from './panels/VehiclePanel';
import { DiagnosticsPanel } from './panels/DiagnosticsPanel';
import { WiringPanel } from './panels/WiringPanel';
import { LaborPanel } from './panels/LaborPanel';
import { MaintenancePanel } from './panels/MaintenancePanel';
import { ProceduresPanel, ProcedureView } from './panels/ProceduresPanel';

const theme = { name: 'atelier', className: 'dockview-theme-atelier' };

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  vehicle: () => <VehiclePanel />,
  diagnostics: () => <DiagnosticsPanel />,
  wiring: () => <WiringPanel />,
  labor: () => <LaborPanel />,
  maintenance: () => <MaintenancePanel />,
  procedures: () => <ProceduresPanel />,
  procedure: (p: IDockviewPanelProps<{ procedureId: number }>) => <ProcedureView procedureId={p.params.procedureId} />,
};

const RAIL: { kind: PanelKind; icon: string; short: string }[] = [
  { kind: 'vehicle', icon: 'car', short: 'Véhicule' },
  { kind: 'diagnostics', icon: 'diag', short: 'Diagnostic' },
  { kind: 'wiring', icon: 'wiring', short: 'Schémas' },
  { kind: 'maintenance', icon: 'calendar', short: 'Entretien' },
  { kind: 'labor', icon: 'labor', short: 'Devis' },
  { kind: 'procedures', icon: 'book', short: 'Méthodes' },
];

const LAYOUT_KEY = 'autotech.layout.v1';

export default function Workbench() {
  const { setDock, open, setVehicle, vehicle, dock } = useApp();

  useEffect(() => { const v = restoreVehicle(); if (v) setVehicle(v); }, [setVehicle]);

  useEffect(() => {
    if (!dock) return;
    const d = dock.onDidLayoutChange(() => {
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(dock.toJSON())); } catch { /* storage unavailable */ }
    });
    return () => d.dispose();
  }, [dock]);

  const onReady = (e: DockviewReadyEvent) => {
    setDock(e.api);
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) { e.api.fromJSON(JSON.parse(raw)); if (e.api.panels.length) return; }
    } catch { e.api.clear(); }
    e.api.addPanel({ id: 'vehicle', component: 'vehicle', title: PANEL_TITLES.vehicle });
  };

  return (
    <div className="h-dvh flex flex-col">
      <TopBar />
      <div className="flex-1 flex flex-col-reverse md:flex-row min-h-0">
        <nav aria-label="Modules" className="flex md:flex-col gap-1 p-1.5 md:w-[78px] border-t md:border-t-0 md:border-r border-[var(--line)] bg-[var(--bay)] overflow-x-auto">
          {RAIL.map(r => {
            const disabled = r.kind !== 'vehicle' && !vehicle;
            return (
              <button key={r.kind} onClick={() => open(r.kind)} disabled={disabled} title={disabled ? 'Identifiez un véhicule' : PANEL_TITLES[r.kind]}
                className="flex flex-col items-center gap-1 px-2 py-2 rounded text-ink-2 hover:text-ink hover:bg-[var(--panel)] disabled:opacity-35 disabled:hover:bg-transparent min-w-[64px]">
                <Icon name={r.icon} size={22} />
                <span className="cond text-[13px] font-semibold">{r.short}</span>
              </button>
            );
          })}
        </nav>
        <main className="flex-1 min-w-0 min-h-0">
          <DockviewReact className="h-full" theme={theme} components={components} onReady={onReady} />
        </main>
      </div>
    </div>
  );
}
