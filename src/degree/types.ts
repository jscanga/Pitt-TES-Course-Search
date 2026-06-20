/** A parsed course from a transcript or What-If report. */
export interface ParsedCourse {
  term: string;
  subject: string;
  catalog: string;
  /** "CS 0445" — subject + catalog, the join key against requirements & TES */
  code: string;
  title: string;
  units: number;
  grade: string;
  status: 'completed' | 'in_progress' | 'transfer';
  /** true when the user added/edited this row by hand */
  manual?: boolean;
}

export type SatisfiedBy =
  | { anyOf: string[] }
  | { courses: string[] }
  | { sequences: string[][] }
  | { predicate: string };

export type ReqKind = 'courses' | 'sequence' | 'units' | 'flag';

export interface Requirement {
  id: string;
  section: string;
  label: string;
  kind: ReqKind;
  n: number;
  satisfiedBy: SatisfiedBy;
  minGrade?: string;
  major?: 'CS' | 'DS';
  transferEligible: boolean;
  residencyLocked: boolean;
  eligibleNote: string;
}

export interface GlobalRules {
  minUnits: number;
  minResidencyCredits: number;
  minMajorCreditsInResidency: number;
  majorResidencyFraction: number;
  pedcMilsCap: number;
}

export interface RequirementModel {
  catalogYear: string;
  program: string;
  plans: string[];
  globalRules: GlobalRules;
  sections: Requirement[];
}

/** Computed progress for one requirement against the user's courses. */
export interface ReqProgress {
  req: Requirement;
  satisfied: boolean;
  usedCourses: string[]; // course codes applied to this slot
  used: number;          // slots or units filled
  needed: number;        // slots or units still open
  /** course codes added hypothetically that count here */
  hypothetical: string[];
}

export interface DegreeSummary {
  totalUnits: number;
  unitsNeeded: number;
  majorUnitsAtPitt: number;
  majorUnitsTotal: number;
  majorResidencyOk: boolean;
  residencyCredits: number;
}
