/** Maintenance due-date engine (mileage and time based, "whichever comes first"). */

export interface MaintenanceItemInput {
  id: number;
  task: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  firstAtKm: number | null;
  firstAtMonths: number | null;
  whicheverFirst: boolean;
}

export interface LastService { itemId: number; km: number; ageMonths: number; }

export type DueStatus = 'overdue' | 'due' | 'upcoming' | 'ok';

export interface DueItem {
  id: number;
  task: string;
  status: DueStatus;
  nextKm: number | null;
  nextAgeMonths: number | null;
  remainingKm: number | null;
  remainingMonths: number | null;
}

export interface DueOptions {
  dueWindowKm?: number;       // "due" when within this distance (default 1 500 km)
  dueWindowMonths?: number;   // or within this time (default 1 month)
  upcomingWindowKm?: number;  // "upcoming" window (default 5 000 km)
  upcomingWindowMonths?: number;
}

function nextAt(current: number, last: number | undefined, first: number | null, interval: number | null): number | null {
  if (interval == null) return null;
  if (last != null) return last + interval;
  const start = first ?? interval;
  if (current <= start) return start;
  // no history recorded: next milestone of the schedule at or after the current value
  return start + Math.ceil((current - start) / interval) * interval;
}

export function computeDueItems(
  items: MaintenanceItemInput[],
  vehicle: { km: number; ageMonths: number },
  history: LastService[] = [],
  opts: DueOptions = {},
): DueItem[] {
  const o = { dueWindowKm: 1500, dueWindowMonths: 1, upcomingWindowKm: 5000, upcomingWindowMonths: 3, ...opts };
  const lastById = new Map(history.map(h => [h.itemId, h]));
  return items.map(it => {
    const last = lastById.get(it.id);
    const nextKm = nextAt(vehicle.km, last?.km, it.firstAtKm, it.intervalKm);
    const nextAge = nextAt(vehicle.ageMonths, last?.ageMonths, it.firstAtMonths, it.intervalMonths);
    const remKm = nextKm == null ? null : nextKm - vehicle.km;
    const remMo = nextAge == null ? null : nextAge - vehicle.ageMonths;

    const level = (rem: number | null, due: number, upcoming: number): DueStatus => {
      if (rem == null) return 'ok';
      if (rem < 0) return 'overdue';
      if (rem <= due) return 'due';
      if (rem <= upcoming) return 'upcoming';
      return 'ok';
    };
    const a = level(remKm, o.dueWindowKm, o.upcomingWindowKm);
    const b = level(remMo, o.dueWindowMonths, o.upcomingWindowMonths);
    const rank: DueStatus[] = ['overdue', 'due', 'upcoming', 'ok'];
    const status = it.whicheverFirst
      ? rank[Math.min(rank.indexOf(a), rank.indexOf(b))]!
      : rank[Math.max(rank.indexOf(a), rank.indexOf(b))]!;
    return { id: it.id, task: it.task, status, nextKm, nextAgeMonths: nextAge, remainingKm: remKm, remainingMonths: remMo };
  }).sort((x, y) => ['overdue', 'due', 'upcoming', 'ok'].indexOf(x.status) - ['overdue', 'due', 'upcoming', 'ok'].indexOf(y.status));
}
