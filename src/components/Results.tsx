import { useMemo } from 'react';
import { cheapestFor, distFor, filterOnline, rateFor, sortColleges } from '../lib/cost';
import type { CostIndex, CourseGroup, LatLng, SortMode } from '../types';

interface CourseCardProps {
  group: CourseGroup;
  costs: CostIndex;
  userState: string;
  userLoc: LatLng | null;
  sortMode: SortMode;
  pittRate: number;
  onlineOnly: boolean;
  open: boolean;
  onToggle: () => void;
}

export function CourseCard({
  group,
  costs,
  userState,
  userLoc,
  sortMode,
  pittRate,
  onlineOnly,
  open,
  onToggle,
}: CourseCardProps) {
  const visible = useMemo(
    () => filterOnline(group.colleges, costs, onlineOnly),
    [group.colleges, costs, onlineOnly],
  );
  const sorted = useMemo(
    () => sortColleges(visible, sortMode, costs, userState, userLoc),
    [visible, sortMode, costs, userState, userLoc],
  );
  const cheapest = useMemo(
    () => cheapestFor(visible, costs, userState),
    [visible, costs, userState],
  );
  const save3 = cheapest ? Math.max(0, Math.round((pittRate - cheapest.rate) * 3)) : 0;

  return (
    <div className={`course-group${open ? ' open' : ''}`}>
      <button className="course-header" onClick={onToggle} aria-expanded={open}>
        <svg
          className="chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <div className="course-code">{group.code}</div>
        <div className="course-title">{group.title || '—'}</div>
        {cheapest && (
          <div className="badge min-cost">
            from ${Math.round(cheapest.rate).toLocaleString()}/cr
          </div>
        )}
        <div className="badge count">
          {sorted.length} college{sorted.length !== 1 ? 's' : ''}
        </div>
      </button>

      {open && cheapest && (
        <div className="spread">
          <span className="cheapest">
            ${Math.round(cheapest.rate).toLocaleString()}/cr
          </span>
          <span>cheapest — {cheapest.college}</span>
          {pittRate > 0 && (
            <span className="save">
              save ~${save3.toLocaleString()} per 3-credit course vs Pitt
            </span>
          )}
        </div>
      )}

      {open && (
        <div className="course-body">
          {sorted.map((c) => {
            const r = rateFor(costs, c.college, userState);
            const d = distFor(costs, c.college, userLoc);
            const exShare = r?.rec.onlineExclusiveShare ?? null;
            const anyShare = r?.rec.onlineShare ?? null;
            const onlineTag =
              exShare != null && exShare >= 0.85
                ? 'fully online'
                : anyShare != null && anyShare > 0
                  ? `${Math.round(anyShare * 100)}% online`
                  : '';
            const sub = [
              r ? [r.rec.city, r.rec.state].filter(Boolean).join(', ') : '',
              d != null ? `${Math.round(d)} mi` : '',
              onlineTag,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <div className="college-row" key={`${c.college}|${c.txCode}`}>
                <div>
                  <div className="college-name">{c.college}</div>
                  {sub && <div className="college-sub">{sub}</div>}
                </div>
                <div className="tx-info">
                  <div className="tx-code">{c.txCode}</div>
                  <div className="tx-title">{c.txTitle}</div>
                </div>
                <div className="ledger">
                  {r ? (
                    <>
                      <span className="amt">
                        ${Math.round(r.value).toLocaleString()}
                      </span>
                      <span className="tag">{r.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="amt none">—</span>
                      <span className="tag">no cost data</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ResultsListProps extends Omit<CourseCardProps, 'group' | 'open' | 'onToggle'> {
  groups: CourseGroup[];
  query: string;
  openCodes: Set<string>;
  onToggle: (code: string) => void;
}

export function ResultsList({
  groups,
  query,
  openCodes,
  onToggle,
  ...rest
}: ResultsListProps) {
  if (!query.trim()) return null;

  const nonEmpty = rest.onlineOnly
    ? groups.filter((g) => filterOnline(g.colleges, rest.costs, true).length > 0)
    : groups;

  if (!nonEmpty.length) {
    return (
      <div className="results">
        <div className="empty-state">
          No matches for <strong>{query}</strong>
          {rest.onlineOnly ? ' with online-friendly colleges' : ''}.
          <br />
          {rest.onlineOnly
            ? 'Try turning off "Online options only".'
            : 'Try a partial code like CHEM, or a word from the title like “calculus”.'}
        </div>
      </div>
    );
  }

  const total = nonEmpty.reduce(
    (s, g) => s + filterOnline(g.colleges, rest.costs, rest.onlineOnly).length,
    0,
  );

  return (
    <div className="results">
      <div className="results-header">
        <b>{nonEmpty.length}</b> Pitt course{nonEmpty.length !== 1 ? 's' : ''} ·{' '}
        <b>{total}</b> transfer option{total !== 1 ? 's' : ''}
        {rest.onlineOnly ? ' · online-friendly only' : ''}
      </div>
      {nonEmpty.map((g) => (
        <CourseCard
          key={g.code}
          group={g}
          open={openCodes.has(g.code) || nonEmpty.length === 1}
          onToggle={() => onToggle(g.code)}
          {...rest}
        />
      ))}
    </div>
  );
}
