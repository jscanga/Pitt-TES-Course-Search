import { useCallback, useMemo, useState } from 'react';
import { Controls, SearchBar, TopBar } from './components/Chrome';
import { DataDrawer } from './components/DataDrawer';
import { ResultsList } from './components/Results';
import { useDebounce } from './hooks/useDebounce';
import { useTesData } from './hooks/useTesData';
import { filterOnline, rateFor, sortColleges } from './lib/cost';
import { downloadFile, searchAndGroup, toCsv } from './lib/data';
import type { LatLng, SortMode } from './types';

const DEFAULT_PITT_RATE = 1015; // editable in the UI; varies by school + residency

export default function App() {
  const { db, costs, status, costsLoaded, mergePasted } = useTesData();

  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('cost');
  const [userState, setUserState] = useState('PA');
  const [pittRate, setPittRate] = useState(DEFAULT_PITT_RATE);
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [locStatus, setLocStatus] = useState<'idle' | 'locating' | 'set' | 'blocked'>('idle');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [openCodes, setOpenCodes] = useState<Set<string>>(new Set());

  const debouncedQuery = useDebounce(query, 200);
  const groups = useMemo(
    () => searchAndGroup(db, debouncedQuery),
    [db, debouncedQuery],
  );

  const toggleCode = useCallback((code: string) => {
    setOpenCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocStatus('blocked');
      return;
    }
    setLocStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocStatus('set');
        setSortMode('dist');
      },
      () => setLocStatus('blocked'),
    );
  }, []);

  const exportResultsCsv = useCallback(() => {
    if (!groups.length) return;
    const rows: (string | number)[][] = [
      ['Pitt Course Code', 'Pitt Course Title', 'College', 'Transfer Course Code', 'Transfer Course Title', 'Est $/Credit', 'Rate Type', 'State'],
    ];
    for (const g of groups) {
      const visible = filterOnline(g.colleges, costs, onlineOnly);
      for (const c of sortColleges(visible, sortMode, costs, userState, userLoc)) {
        const r = rateFor(costs, c.college, userState);
        rows.push([
          g.code,
          g.title,
          c.college,
          c.txCode,
          c.txTitle,
          r ? Math.round(r.value) : '',
          r ? r.label : '',
          r ? r.rec.state : '',
        ]);
      }
    }
    const slug = (debouncedQuery || 'results').replace(/\s+/g, '-');
    downloadFile(toCsv(rows), `tes-${slug}.csv`, 'text/csv');
  }, [groups, sortMode, costs, userState, userLoc, onlineOnly, debouncedQuery]);

  return (
    <>
      <TopBar db={db} />
      <div className="container">
        <div className="hero">
          <h2>
            Find the same Pitt credit,
            <br />
            for a <em>fraction of the price</em>.
          </h2>
          <p>
            Search any Pitt course by code or title and see every college that
            transfers in as an exact equivalent — sorted by what it actually
            costs per credit.
          </p>
          <SearchBar value={query} onChange={setQuery} />
          <Controls
            sortMode={sortMode}
            onSortMode={setSortMode}
            userState={userState}
            onUserState={setUserState}
            pittRate={pittRate}
            onPittRate={setPittRate}
            locStatus={locStatus}
            onUseLocation={useMyLocation}
            onlineOnly={onlineOnly}
            onOnlineOnly={setOnlineOnly}
            costsLoaded={costsLoaded}
          />
        </div>

        <ResultsList
          groups={groups}
          query={debouncedQuery}
          openCodes={openCodes}
          onToggle={toggleCode}
          costs={costs}
          userState={userState}
          userLoc={userLoc}
          sortMode={sortMode}
          pittRate={pittRate}
          onlineOnly={onlineOnly}
        />

        {groups.length > 0 && (
          <div className="export-row">
            <button className="btn-ghost" onClick={exportResultsCsv}>
              Export results to CSV
            </button>
            <button className="btn-ghost" onClick={() => setQuery('')}>
              Clear
            </button>
          </div>
        )}

        <DataDrawer db={db} status={status} onMerge={mergePasted} />

        <footer>
          Per-credit figures are estimates derived from IPEDS published charges
          (some are annual tuition ÷ 24 credits) and exclude course fees, books,
          and district-resident discounts. Online shares reflect institution-wide
          IPEDS enrollment — always confirm the specific course is offered online. Always confirm on the college's site
          before enrolling. Savings compare against the Pitt $/cr value above —
          edit it to match your school and residency.
        </footer>
      </div>
    </>
  );
}
