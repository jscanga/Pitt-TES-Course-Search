/** One row of the TES database: a course at another college that Pitt
 *  accepts as equivalent to one of its own courses. */
export interface Equivalency {
  college: string;
  txCode: string;
  txTitle: string;
  pittCourse: string;
  pittTitle: string;
}

/** Raw shape of tes-data.json (grouped by institution). */
export interface TesInstitution {
  college: string;
  equivalencies: {
    txCode?: string;
    txTitle?: string;
    pittCode?: string;
    pittCourse?: string;
    pittTitle?: string;
  }[];
}

/** One entry of college-costs.json, produced by pipeline/build_costs.py
 *  from IPEDS data. Keyed by the TES college name for exact lookup. */
export interface CostRecord {
  ipedsName: string;
  state: string;
  city: string;
  lat: number | null;
  lng: number | null;
  perCreditInDistrict: number | null;
  perCreditInState: number | null;
  perCreditOutState: number | null;
  /** how the dollar figure was derived */
  method: 'per_credit_hour' | 'annual_div_24' | string;
  /** how the name was matched to IPEDS */
  matchQuality?: 'exact' | 'family' | 'fuzzy' | string;
  /** undergrad distance-education enrollment (IPEDS EF_DIST), null if unreported */
  onlineExclusive?: number | null;
  onlineSome?: number | null;
  onlineTotal?: number | null;
  /** share of undergrads enrolled exclusively online */
  onlineExclusiveShare?: number | null;
  /** share of undergrads taking at least one online course */
  onlineShare?: number | null;
}

export type CostIndex = Record<string, CostRecord>;

export interface Rate {
  value: number;
  label: 'in-state/cr' | 'out-of-state/cr';
  rec: CostRecord;
}

export interface CollegeOption {
  college: string;
  txCode: string;
  txTitle: string;
}

export interface CourseGroup {
  code: string;
  title: string;
  colleges: CollegeOption[];
}

export type SortMode = 'cost' | 'az' | 'dist';

export interface LatLng {
  lat: number;
  lng: number;
}
