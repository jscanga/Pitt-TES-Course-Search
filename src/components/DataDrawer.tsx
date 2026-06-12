import { useRef } from 'react';
import { downloadFile, toCsv } from '../lib/data';
import type { Status } from '../hooks/useTesData';
import type { Equivalency } from '../types';

interface DataDrawerProps {
  db: Equivalency[];
  status: Status;
  onMerge: (raw: string) => boolean;
}

export function DataDrawer({ db, status, onMerge }: DataDrawerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  const handleMerge = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (onMerge(ta.value)) ta.value = '';
  };

  const exportJson = () => {
    const byCollege = new Map<string, Equivalency[]>();
    for (const r of db) {
      const list = byCollege.get(r.college) ?? [];
      list.push(r);
      byCollege.set(r.college, list);
    }
    const out = [...byCollege.entries()].map(([college, rows]) => ({
      college,
      equivalencies: rows.map((r) => ({
        txCode: r.txCode,
        txTitle: r.txTitle,
        pittCode: r.pittCourse,
        pittTitle: r.pittTitle,
      })),
    }));
    downloadFile(JSON.stringify(out, null, 2), 'tes-data.json', 'application/json');
  };

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      ['Pitt Course Code', 'Pitt Course Title', 'College', 'Transfer Course Code', 'Transfer Course Title'],
    ];
    [...db]
      .sort(
        (a, b) =>
          a.pittCourse.localeCompare(b.pittCourse) || a.college.localeCompare(b.college),
      )
      .forEach((r) => rows.push([r.pittCourse, r.pittTitle, r.college, r.txCode, r.txTitle]));
    downloadFile(toCsv(rows), 'tes-data-full.csv', 'text/csv');
  };

  return (
    <details className="drawer">
      <summary>Data — load, merge, export</summary>
      <div className="drawer-body">
        <div className={`status ${status.kind}`}>{status.msg}</div>
        <textarea
          ref={taRef}
          placeholder="Paste TES_DATA:[...] scraper output here to merge more equivalencies…"
        />
        <div className="btn-row">
          <button className="btn-primary" onClick={handleMerge}>
            Merge pasted data
          </button>
        </div>
        {db.length > 0 && (
          <div className="btn-row">
            <span className="label">Export full database:</span>
            <button className="btn-ghost" onClick={exportJson}>
              tes-data.json
            </button>
            <button className="btn-ghost" onClick={exportCsv}>
              full .csv
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
