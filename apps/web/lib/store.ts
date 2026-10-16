'use client';
import { create } from 'zustand';
import type { DockviewApi } from 'dockview';
import type { Variant } from './api';

export type PanelKind = 'vehicle' | 'diagnostics' | 'wiring' | 'labor' | 'maintenance' | 'procedures' | 'procedure';

export const PANEL_TITLES: Record<PanelKind, string> = {
  vehicle: 'Véhicule',
  diagnostics: 'Diagnostic guidé',
  wiring: 'Schémas électriques',
  labor: 'Temps & devis',
  maintenance: 'Entretien',
  procedures: 'Méthodes',
  procedure: 'Méthode',
};

export interface WiringFocus { diagramId: number; svgElementId: string; nonce: number }

interface State {
  vehicle: Variant | null;
  dock: DockviewApi | null;
  wiringFocus: WiringFocus | null;
  laborPreset: { operationIds: number[]; nonce: number } | null;
  setVehicle: (v: Variant | null) => void;
  setDock: (d: DockviewApi) => void;
  open: (kind: PanelKind, opts?: { id?: string; title?: string; params?: Record<string, unknown>; split?: boolean }) => void;
  focusWiring: (diagramId: number, svgElementId: string) => void;
  presetLabor: (operationIds: number[]) => void;
}

const STORAGE_KEY = 'autotech.vehicle';

export const useApp = create<State>((set, get) => ({
  vehicle: null,
  dock: null,
  wiringFocus: null,
  laborPreset: null,
  setVehicle: v => {
    set({ vehicle: v });
    try { v ? localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) : localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  },
  setDock: d => set({ dock: d }),
  open: (kind, opts = {}) => {
    const dock = get().dock;
    if (!dock) return;
    const id = opts.id ?? kind;
    const existing = dock.getPanel(id);
    if (existing) {
      existing.api.setActive();
      if (opts.params) existing.api.updateParameters(opts.params);
      return;
    }
    const active = dock.activePanel;
    dock.addPanel({
      id,
      component: kind,
      title: opts.title ?? PANEL_TITLES[kind],
      params: opts.params ?? {},
      ...(active && opts.split ? { position: { referencePanel: active, direction: 'right' as const } } : {}),
    });
  },
  focusWiring: (diagramId, svgElementId) => {
    set({ wiringFocus: { diagramId, svgElementId, nonce: Date.now() } });
    get().open('wiring', { split: true });
  },
  presetLabor: operationIds => {
    set({ laborPreset: { operationIds, nonce: Date.now() } });
    get().open('labor');
  },
}));

export function restoreVehicle(): Variant | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Variant) : null;
  } catch { return null; }
}
