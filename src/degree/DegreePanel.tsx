import { useCallback, useMemo, useRef, useState } from 'react';
import { allProgress, summarize } from './engine';
import { dedupeForRequirements, parseTranscript } from './parseTranscript';
import { useRequirementModel } from './useRequirementModel';
import type { ParsedCourse, ReqProgress } from './types';

interface DegreePanelProps {
  /** jump the main search to a code (to find cheap transfer options) */
  onFindCourse: (code: string) => void;
}

export function DegreePanel({ onFindCourse }: DegreePanelProps) {
  const { model, error } = useRequirementModel();
  const [courses, setCourses] = useState<ParsedCourse[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback(async (file: File) => {
    setParsing(true);
    setWarnings([]);
    try {
      const buf = await file.arrayBuffer();
      const res = await parseTranscript(buf);
      setCourses(res.courses);
      setWarnings(res.warnings);
      setReviewing(true);
    } catch {
      setWarnings(['Could not read that PDF. Try your Pitt transcript or What-If report.']);
    } finally {
      setParsing(false);
    }
  }, []);

  const deduped = useMemo(() => dedupeForRequirements(courses), [courses]);
  const noHypo = useMemo(() => new Set<string>(), []);
  const progress = useMemo(
    () => (model ? allProgress(model, deduped, noHypo) : []),
    [model, deduped, noHypo],
  );
  const summary = useMemo(
    () => (model ? summarize(model, deduped, noHypo) : null),
    [model, deduped, noHypo],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, ReqProgress[]>();
    for (const p of progress) {
      const arr = m.get(p.req.section) ?? [];
      arr.push(p);
      m.set(p.req.section, arr);
    }
    return [...m.entries()];
  }, [progress]);

  const updateRow = (i: number, patch: Partial<ParsedCourse>) => {
    setCourses((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch, manual: true } : c)));
  };
  const removeRow = (i: number) => setCourses((prev) => prev.filter((_, idx) => idx !== i));

  if (error) return <div className="status error">{error}</div>;
  if (!model) return <div className="status">Loading requirement model…</div>;

  return (
    <div className="degree">
      <div className="degree-intro">
        <h3>Degree Progress</h3>
        <p>
          Upload your Pitt unofficial transcript or Academic Advisement (What-If)
          report. It's parsed in your browser — nothing is uploaded anywhere. CS +
          Data Science, {model.catalogYear} catalog.
        </p>
        <div className="btn-row">
          <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={parsing}>
            {parsing ? 'Reading…' : courses.length ? 'Replace transcript' : 'Upload transcript PDF'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          {courses.length > 0 && (
            <button className="btn-ghost" onClick={() => setReviewing((r) => !r)}>
              {reviewing ? 'Hide' : 'Review'} parsed courses ({courses.length})
            </button>
          )}
        </div>
        {warnings.map((w, i) => (
          <div key={i} className="status error" style={{ marginTop: 10 }}>{w}</div>
        ))}
      </div>

      {reviewing && courses.length > 0 && (
        <div className="review-table">
          <div className="review-head">
            Confirm what was parsed — edit grades/credits or remove rows before it
            counts. In-progress courses count as assumed-complete, matching Pitt's report.
          </div>
          {courses.map((c, i) => (
            <div className="review-row" key={`${c.term}-${c.code}-${i}`}>
              <span className="rc-code">{c.code}</span>
              <span className="rc-title">{c.title || '—'}</span>
              <input
                className="rc-units"
                type="number"
                step="0.5"
                value={c.units}
                onChange={(e) => updateRow(i, { units: parseFloat(e.target.value) || 0 })}
              />
              <select
                className="rc-status"
                value={c.status}
                onChange={(e) => updateRow(i, { status: e.target.value as ParsedCourse['status'] })}
              >
                <option value="completed">completed</option>
                <option value="in_progress">in progress</option>
                <option value="transfer">transfer</option>
              </select>
              <button className="rc-del" onClick={() => removeRow(i)} aria-label="Remove">×</button>
            </div>
          ))}
        </div>
      )}

      {summary && courses.length > 0 && (
        <div className="degree-summary">
          <div className="ds-stat">
            <b>{summary.totalUnits}</b><span>/ {model.globalRules.minUnits} units</span>
          </div>
          <div className="ds-stat">
            <b>{summary.unitsNeeded}</b><span>units to go</span>
          </div>
          <div className={`ds-stat ${summary.majorResidencyOk ? 'ok' : 'warn'}`}>
            <b>{summary.majorUnitsAtPitt}/{summary.majorUnitsTotal}</b>
            <span>major credits at Pitt {summary.majorResidencyOk ? '✓' : '⚠ below 50%'}</span>
          </div>
        </div>
      )}

      {courses.length > 0 &&
        grouped.map(([section, reqs]) => (
          <div className="req-section" key={section}>
            <div className="req-section-title">{section}</div>
            {reqs.map((p) => (
              <RequirementRow key={p.req.id} p={p} onFindCourse={onFindCourse} />
            ))}
          </div>
        ))}
    </div>
  );
}

function RequirementRow({
  p,
  onFindCourse,
}: {
  p: ReqProgress;
  onFindCourse: (code: string) => void;
}) {
  const { req } = p;
  const firstCode = useMemo(() => {
    const sb = req.satisfiedBy;
    if ('anyOf' in sb) return sb.anyOf[0];
    if ('courses' in sb) return sb.courses[0];
    if ('sequences' in sb) return sb.sequences[0]?.[0];
    return undefined;
  }, [req]);

  return (
    <div className={`req-row${p.satisfied ? ' done' : ''}`}>
      <span className="req-check">{p.satisfied ? '✓' : '○'}</span>
      <div className="req-main">
        <div className="req-label">{req.label}</div>
        {p.usedCourses.length > 0 && (
          <div className="req-used">
            {p.usedCourses.join(', ')}
            {p.hypothetical.length > 0 && <em> (planned)</em>}
          </div>
        )}
        {!p.satisfied && req.eligibleNote && (
          <div className="req-note">{req.eligibleNote}</div>
        )}
      </div>
      <div className="req-flag">
        {p.satisfied ? null : req.transferEligible ? (
          <button
            className="req-transfer"
            onClick={() => firstCode && onFindCourse(firstCode)}
            title="Find the cheapest college to take this and transfer in"
          >
            transferable — find cheap option
          </button>
        ) : (
          <span className="req-locked">Pitt only</span>
        )}
      </div>
    </div>
  );
}
