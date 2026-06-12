import type { ChangeEvent } from 'react';
import type { Equivalency, SortMode } from '../types';

const STATES = ['', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

export function TopBar({ db }: { db: Equivalency[] }) {
  const colleges = new Set(db.map((r) => r.college)).size;
  const courses = new Set(db.map((r) => r.pittCourse)).size;
  return (
    <div className="topbar">
      <div className="wordmark">
        TES<span>//</span>LEDGER
      </div>
      <h1>Pitt transfer course finder</h1>
      <div className="top-stats">
        <span>
          <b>{courses ? courses.toLocaleString() : '—'}</b> Pitt courses
        </span>
        <span>
          <b>{colleges ? colleges.toLocaleString() : '—'}</b> institutions
        </span>
        <span>
          <b>{db.length ? db.length.toLocaleString() : '—'}</b> equivalencies
        </span>
      </div>
    </div>
  );
}

export function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="search-shell">
      <input
        className="search-input"
        type="text"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder="Course code or title — e.g. CHEM 0110, calculus, intro to psychology"
        autoComplete="off"
        aria-label="Search Pitt courses by code or title"
      />
      {value && (
        <button className="search-clear" onClick={() => onChange('')} aria-label="Clear search">
          CLEAR
        </button>
      )}
    </div>
  );
}

export interface ControlsProps {
  sortMode: SortMode;
  onSortMode: (m: SortMode) => void;
  userState: string;
  onUserState: (s: string) => void;
  pittRate: number;
  onPittRate: (n: number) => void;
  locStatus: 'idle' | 'locating' | 'set' | 'blocked';
  onUseLocation: () => void;
  onlineOnly: boolean;
  onOnlineOnly: (v: boolean) => void;
  costsLoaded: number | null;
}

export function Controls(p: ControlsProps) {
  const locLabel = {
    idle: 'Use my location',
    locating: 'Locating…',
    set: 'Location set',
    blocked: 'Location blocked',
  }[p.locStatus];

  return (
    <div className="controls">
      <label className="ctl">
        Sort
        <select
          value={p.sortMode}
          onChange={(e) => p.onSortMode(e.target.value as SortMode)}
        >
          <option value="cost">$ / credit</option>
          <option value="az">A → Z</option>
          <option value="dist">Nearest</option>
        </select>
      </label>
      <label className="ctl">
        Your state
        <select value={p.userState} onChange={(e) => p.onUserState(e.target.value)}>
          {STATES.map((s) => (
            <option key={s || 'none'} value={s}>
              {s || '—'}
            </option>
          ))}
        </select>
      </label>
      <label
        className="ctl"
        title="Pitt's per-credit rate, used to estimate savings. Edit to match your school and residency."
      >
        Pitt $/cr
        <input
          type="number"
          min={0}
          step={5}
          value={p.pittRate}
          onChange={(e) => p.onPittRate(Number(e.target.value) || 0)}
        />
      </label>
      <button
        className={`ctl-btn${p.locStatus === 'set' ? ' active' : ''}`}
        onClick={p.onUseLocation}
        disabled={p.locStatus === 'locating'}
      >
        {locLabel}
      </button>
      <button
        className={`ctl-btn${p.onlineOnly ? ' active' : ''}`}
        onClick={() => p.onOnlineOnly(!p.onlineOnly)}
        title="Show only colleges where a meaningful share of students study exclusively online"
        aria-pressed={p.onlineOnly}
      >
        Online options only
      </button>
      <span className={`costs-flag ${p.costsLoaded ? 'on' : 'off'}`}>
        {p.costsLoaded
          ? `cost data: ${p.costsLoaded.toLocaleString()} colleges`
          : 'cost data: not loaded (run pipeline/build_costs.py)'}
      </span>
    </div>
  );
}
