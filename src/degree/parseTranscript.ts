import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ParsedCourse } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/** Matches a course row in either the plain transcript or the What-If
 *  "Course History" table once the page text is flattened to lines.
 *  e.g. "2026Spring CS 0441 DISCRETE STRUCTURES FOR CS 3.00 B+" */
const ROW =
  /\b(\d{4}(?:Fall|Spring|Summer))\s+([A-Z]{2,8})\s+(\d{4})\s+(.+?)\s+(\d+\.\d{2})\s+(In Progress|Transfer|[A-DFSWIN][+-]?)\b/;

function classify(grade: string): ParsedCourse['status'] {
  if (grade === 'In Progress') return 'in_progress';
  if (grade === 'Transfer') return 'transfer';
  return 'completed';
}

/** Extract text from each page, joining items with spaces and preserving
 *  line breaks by y-position so row regexes work. */
async function pageLines(file: ArrayBuffer): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: file }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // group text items by rounded y so a visual row becomes one string
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const tr = item.transform as number[];
      const y = Math.round(tr[5]);
      const x = tr[4];
      const arr = rows.get(y) ?? [];
      arr.push({ x, s: item.str });
      rows.set(y, arr);
    }
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0]) // top to bottom
      .forEach(([, items]) => {
        const line = items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.s)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (line) lines.push(line);
      });
  }
  return lines;
}

export interface ParseResult {
  courses: ParsedCourse[];
  /** lines that looked course-like but didn't fully parse, for the review UI */
  warnings: string[];
}

export async function parseTranscript(file: ArrayBuffer): Promise<ParseResult> {
  const lines = await pageLines(file);
  const seen = new Set<string>();
  const courses: ParsedCourse[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    const m = line.match(ROW);
    if (!m) continue;
    const [, term, subject, catalog, titleRaw, unitsRaw, grade] = m;
    const code = `${subject} ${catalog}`;
    const title = titleRaw.replace(/\s+/g, ' ').trim();
    // dedupe identical rows (the What-If report repeats courses across sections),
    // but keep a retake (same code, different term/grade) as its own row
    const key = `${term}|${code}|${grade}`;
    if (seen.has(key)) continue;
    seen.add(key);
    courses.push({
      term,
      subject,
      catalog,
      code,
      title,
      units: parseFloat(unitsRaw),
      grade,
      status: classify(grade),
    });
  }

  if (!courses.length) {
    warnings.push(
      'No course rows found. This works best with a Pitt unofficial transcript ' +
        'or an Academic Advisement / What-If report PDF.',
    );
  }
  return { courses, warnings };
}

/** Collapse retakes: keep the best (most recent non-in-progress, else
 *  in-progress) attempt per course code for requirement matching. */
export function dedupeForRequirements(courses: ParsedCourse[]): ParsedCourse[] {
  const best = new Map<string, ParsedCourse>();
  for (const c of courses) {
    const cur = best.get(c.code);
    if (!cur) {
      best.set(c.code, c);
      continue;
    }
    // prefer completed/transfer over in_progress; otherwise keep later term
    const rank = (x: ParsedCourse) => (x.status === 'in_progress' ? 0 : 1);
    if (rank(c) > rank(cur) || (rank(c) === rank(cur) && c.term > cur.term)) {
      best.set(c.code, c);
    }
  }
  return [...best.values()];
}
