import type {
  DegreeSummary,
  ParsedCourse,
  ReqProgress,
  Requirement,
  RequirementModel,
} from './types';

/** "assumed complete" = anything not failed/withdrawn; mirrors Pitt's
 *  What-If engine, which counts in-progress courses as satisfied. */
function isHeld(c: ParsedCourse): boolean {
  return ['completed', 'in_progress', 'transfer'].includes(c.status);
}

/** Does a single course satisfy (contribute to) this requirement? Used both
 *  for progress and for the "what does this fill" hypothetical interaction.
 *  Predicate-based slots can't be auto-judged from code alone, so they only
 *  accept explicit user placement (returns false here). */
export function courseQualifies(req: Requirement, code: string): boolean {
  const sb = req.satisfiedBy;
  if ('anyOf' in sb) return sb.anyOf.includes(code);
  if ('courses' in sb) return sb.courses.includes(code);
  if ('sequences' in sb) return sb.sequences.some((seq) => seq.includes(code));
  return false; // predicate slots: explicit placement only
}

function heldCodes(courses: ParsedCourse[]): Set<string> {
  return new Set(courses.filter(isHeld).map((c) => c.code));
}

/** Compute progress for one requirement. `hypoCodes` are codes the user has
 *  added speculatively (not on the transcript). */
export function progressFor(
  req: Requirement,
  courses: ParsedCourse[],
  hypoCodes: Set<string>,
): ReqProgress {
  const held = heldCodes(courses);
  const sb = req.satisfiedBy;
  const used: string[] = [];
  const hypothetical: string[] = [];

  const consider = (code: string, fromHypo: boolean) => {
    used.push(code);
    if (fromHypo) hypothetical.push(code);
  };

  if ('sequences' in sb) {
    // satisfied if any full sequence is held (real or hypothetical)
    for (const seq of sb.sequences) {
      const haveAll = seq.every((c) => held.has(c) || hypoCodes.has(c));
      if (haveAll) {
        seq.forEach((c) => consider(c, !held.has(c) && hypoCodes.has(c)));
        break;
      }
    }
    const satisfied = used.length >= req.n;
    return { req, satisfied, usedCourses: used, used: Math.min(used.length, req.n),
             needed: Math.max(0, req.n - used.length), hypothetical };
  }

  if ('anyOf' in sb || 'courses' in sb) {
    const list = 'anyOf' in sb ? sb.anyOf : sb.courses;
    const needAll = 'courses' in sb;
    for (const c of list) {
      if (held.has(c)) consider(c, false);
      else if (hypoCodes.has(c)) consider(c, true);
    }
    const filled = needAll ? (used.length === list.length ? 1 : 0) : used.length;
    const satisfied = needAll ? filled === 1 : used.length >= req.n;
    return {
      req,
      satisfied,
      usedCourses: used,
      used: Math.min(needAll ? used.length : used.length, needAll ? list.length : req.n),
      needed: needAll ? Math.max(0, list.length - used.length) : Math.max(0, req.n - used.length),
      hypothetical,
    };
  }

  // predicate slot: only explicit hypothetical placements count (tracked elsewhere)
  return { req, satisfied: false, usedCourses: [], used: 0, needed: req.n, hypothetical: [] };
}

/** For a course the user is eyeing, which requirements would it help fill
 *  (that aren't already satisfied)? Drives the "add to plan" interaction. */
export function whatItFills(
  model: RequirementModel,
  code: string,
  courses: ParsedCourse[],
  hypoCodes: Set<string>,
): Requirement[] {
  return model.sections.filter((req) => {
    if (!courseQualifies(req, code)) return false;
    const prog = progressFor(req, courses, hypoCodes);
    return !prog.satisfied;
  });
}

const MAJOR_RESIDENCY_NOTE =
  'Pitt requires at least half of major-program credits be earned at Pitt.';

export function summarize(
  model: RequirementModel,
  courses: ParsedCourse[],
  hypoCodes: Set<string>,
): DegreeSummary & { note: string } {
  const held = courses.filter(isHeld);
  const realUnits = held.reduce((s, c) => s + c.units, 0);
  const hypoUnits = [...hypoCodes].length * 3; // assume 3cr for hypotheticals lacking data
  const totalUnits = realUnits + hypoUnits;

  // major credits: courses applied to any CS/DS requirement
  const majorCodes = new Set<string>();
  for (const req of model.sections) {
    if (!req.major) continue;
    for (const c of held) if (courseQualifies(req, c.code)) majorCodes.add(c.code);
  }
  const majorCourses = held.filter((c) => majorCodes.has(c.code));
  const majorUnitsTotal = majorCourses.reduce((s, c) => s + c.units, 0);
  // "at Pitt" = not transfer status
  const majorUnitsAtPitt = majorCourses
    .filter((c) => c.status !== 'transfer')
    .reduce((s, c) => s + c.units, 0);
  const residencyCredits = held
    .filter((c) => c.status !== 'transfer')
    .reduce((s, c) => s + c.units, 0);

  const majorResidencyOk =
    majorUnitsTotal === 0 ||
    majorUnitsAtPitt >= majorUnitsTotal * model.globalRules.majorResidencyFraction;

  return {
    totalUnits,
    unitsNeeded: Math.max(0, model.globalRules.minUnits - totalUnits),
    majorUnitsAtPitt,
    majorUnitsTotal,
    majorResidencyOk,
    residencyCredits,
    note: MAJOR_RESIDENCY_NOTE,
  };
}

export function allProgress(
  model: RequirementModel,
  courses: ParsedCourse[],
  hypoCodes: Set<string>,
): ReqProgress[] {
  return model.sections.map((req) => progressFor(req, courses, hypoCodes));
}
