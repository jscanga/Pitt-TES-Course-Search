import type { CourseGroup, Equivalency, TesInstitution } from '../types';

/** Merge parsed TES institutions into an existing db, deduping rows. */
export function ingest(
  parsed: TesInstitution[],
  existing: Equivalency[],
): { db: Equivalency[]; added: number } {
  const db = [...existing];
  const keys = new Set(db.map((r) => `${r.college}|${r.pittCourse}|${r.txCode}`));
  let added = 0;

  for (const inst of parsed) {
    const college = (inst.college ?? '').trim();
    for (const eq of inst.equivalencies ?? []) {
      const pittCourse = (eq.pittCode ?? eq.pittCourse ?? '').trim();
      const txCode = (eq.txCode ?? '').trim();
      if (!pittCourse) continue;
      const key = `${college}|${pittCourse}|${txCode}`;
      if (keys.has(key)) continue;
      keys.add(key);
      db.push({
        college,
        txCode,
        txTitle: (eq.txTitle ?? '').trim(),
        pittCourse,
        pittTitle: (eq.pittTitle ?? '').trim(),
      });
      added++;
    }
  }
  return { db, added };
}

/** Accepts raw pasted scraper output (with optional TES_DATA:/TES_CHECKPOINT:
 *  prefixes) and returns parsed institutions, or null if unparseable. */
export function parsePasted(raw: string): TesInstitution[] | null {
  let s = raw.trim();
  if (s.startsWith('TES_DATA:')) s = s.slice('TES_DATA:'.length);
  if (s.startsWith('TES_CHECKPOINT:')) s = s.slice('TES_CHECKPOINT:'.length);
  const match = s.match(/(\[[\s\S]*\])/);
  if (match) s = match[1];
  try {
    const parsed: unknown = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as TesInstitution[]) : null;
  } catch {
    return null;
  }
}

/** Search by Pitt course code OR title; group results per Pitt course. */
export function searchAndGroup(db: Equivalency[], query: string): CourseGroup[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];

  const groups = new Map<string, CourseGroup>();
  const seen = new Set<string>();

  for (const r of db) {
    if (
      !r.pittCourse.toUpperCase().includes(q) &&
      !r.pittTitle.toUpperCase().includes(q)
    )
      continue;

    let g = groups.get(r.pittCourse);
    if (!g) {
      g = { code: r.pittCourse, title: r.pittTitle, colleges: [] };
      groups.set(r.pittCourse, g);
    }
    const dupKey = `${r.pittCourse}|${r.college}|${r.txCode}`;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    g.colleges.push({ college: r.college, txCode: r.txCode, txTitle: r.txTitle });
  }

  return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export function downloadFile(content: string, filename: string, mime: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
