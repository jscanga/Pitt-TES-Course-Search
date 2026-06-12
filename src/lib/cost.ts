import type {
  CollegeOption,
  CostIndex,
  LatLng,
  Rate,
  SortMode,
} from '../types';

/** Pick the per-credit rate that applies to this user for this college. */
export function rateFor(
  costs: CostIndex,
  college: string,
  userState: string,
): Rate | null {
  const rec = costs[college];
  if (!rec) return null;

  if (userState && rec.state === userState) {
    const v = rec.perCreditInState ?? rec.perCreditInDistrict;
    return v == null ? null : { value: v, label: 'in-state/cr', rec };
  }
  if (rec.perCreditOutState != null) {
    return { value: rec.perCreditOutState, label: 'out-of-state/cr', rec };
  }
  if (rec.perCreditInState != null) {
    return { value: rec.perCreditInState, label: 'in-state/cr', rec };
  }
  return null;
}

export function haversineMi(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function distFor(
  costs: CostIndex,
  college: string,
  userLoc: LatLng | null,
): number | null {
  const rec = costs[college];
  if (!rec || !userLoc || rec.lat == null || rec.lng == null) return null;
  return haversineMi(userLoc, { lat: rec.lat, lng: rec.lng });
}

/** Sort a course's transfer options by the chosen mode.
 *  Colleges without data always sink to the bottom. */
export function sortColleges(
  colleges: CollegeOption[],
  mode: SortMode,
  costs: CostIndex,
  userState: string,
  userLoc: LatLng | null,
): CollegeOption[] {
  const arr = [...colleges];
  if (mode === 'az') {
    return arr.sort((a, b) => a.college.localeCompare(b.college));
  }
  if (mode === 'dist') {
    return arr.sort((a, b) => {
      const da = distFor(costs, a.college, userLoc);
      const db = distFor(costs, b.college, userLoc);
      if (da == null && db == null) return a.college.localeCompare(b.college);
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  }
  return arr.sort((a, b) => {
    const ra = rateFor(costs, a.college, userState);
    const rb = rateFor(costs, b.college, userState);
    if (!ra && !rb) return a.college.localeCompare(b.college);
    if (!ra) return 1;
    if (!rb) return -1;
    return ra.value - rb.value;
  });
}

/** A college is "online-friendly" when a meaningful population studies there
 *  exclusively online — strong evidence it runs full online courses a remote
 *  student could take. */
export function isOnlineFriendly(costs: CostIndex, college: string): boolean {
  const rec = costs[college];
  if (!rec) return false;
  const exShare = rec.onlineExclusiveShare ?? 0;
  const exCount = rec.onlineExclusive ?? 0;
  return exShare >= 0.15 || exCount >= 1000;
}

export function filterOnline(
  colleges: CollegeOption[],
  costs: CostIndex,
  enabled: boolean,
): CollegeOption[] {
  if (!enabled) return colleges;
  return colleges.filter((c) => isOnlineFriendly(costs, c.college));
}

/** Cheapest available rate for a course across all its transfer options. */
export function cheapestFor(
  colleges: CollegeOption[],
  costs: CostIndex,
  userState: string,
): { rate: number; college: string } | null {
  let best: { rate: number; college: string } | null = null;
  for (const c of colleges) {
    const r = rateFor(costs, c.college, userState);
    if (r && (!best || r.value < best.rate)) {
      best = { rate: r.value, college: c.college };
    }
  }
  return best;
}
