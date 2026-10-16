import { describe, it, expect } from 'vitest';
import { computeDueItems, type MaintenanceItemInput } from './maintenance';

const items: MaintenanceItemInput[] = [
  { id: 1, task: 'Vidange + filtre à huile', intervalKm: 15000, intervalMonths: 12, firstAtKm: null, firstAtMonths: null, whicheverFirst: true },
  { id: 2, task: 'Kit distribution', intervalKm: 120000, intervalMonths: 72, firstAtKm: null, firstAtMonths: null, whicheverFirst: true },
  { id: 3, task: 'Liquide de frein', intervalKm: null, intervalMonths: 24, firstAtKm: null, firstAtMonths: 36, whicheverFirst: true },
];

describe('maintenance due engine', () => {
  it('flags items due from history', () => {
    const r = computeDueItems(items, { km: 89000, ageMonths: 70 }, [{ itemId: 1, km: 75000, ageMonths: 60 }]);
    expect(r.find(i => i.id === 1)!.status).toBe('due');     // 90 000 km, 1 000 km left
    expect(r.find(i => i.id === 2)!.status).toBe('upcoming'); // 72 months, 2 months left
  });

  it('marks overdue when past the interval', () => {
    const r = computeDueItems(items, { km: 95000, ageMonths: 75 }, [{ itemId: 1, km: 75000, ageMonths: 60 }]);
    expect(r[0]!.status).toBe('overdue');
    expect(r[0]!.id).toBe(1);
  });

  it('uses first-service offset when no history', () => {
    const r = computeDueItems(items, { km: 10000, ageMonths: 20 });
    const brake = r.find(i => i.id === 3)!;
    expect(brake.nextAgeMonths).toBe(36);
    expect(brake.status).toBe('ok');
  });
});
