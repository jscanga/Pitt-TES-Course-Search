import { useCallback, useEffect, useState } from 'react';
import { ingest, parsePasted } from '../lib/data';
import type { CostIndex, Equivalency, TesInstitution } from '../types';

export type Status = { msg: string; kind: '' | 'success' | 'error' };

/** Loads tes-data.json and college-costs.json from /public on mount and
 *  exposes paste-merge for additional scraper batches. */
export function useTesData() {
  const [db, setDb] = useState<Equivalency[]>([]);
  const [costs, setCosts] = useState<CostIndex>({});
  const [status, setStatus] = useState<Status>({ msg: 'Loading data…', kind: '' });
  const [costsLoaded, setCostsLoaded] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/tes-data.json');
        if (!res.ok) throw new Error('not found');
        const parsed = (await res.json()) as TesInstitution[];
        if (cancelled) return;
        const { db: merged } = ingest(parsed, []);
        const colleges = new Set(merged.map((r) => r.college)).size;
        setDb(merged);
        setStatus({
          msg: `Loaded ${merged.length.toLocaleString()} equivalencies across ${colleges.toLocaleString()} institutions.`,
          kind: 'success',
        });
      } catch {
        if (!cancelled)
          setStatus({
            msg: 'No tes-data.json found in /public. Paste TES_DATA below, or add the file and redeploy.',
            kind: '',
          });
      }
    })();

    (async () => {
      try {
        const res = await fetch('/college-costs.json');
        if (!res.ok) throw new Error('not found');
        const parsed = (await res.json()) as CostIndex;
        if (cancelled) return;
        setCosts(parsed);
        setCostsLoaded(Object.keys(parsed).length);
      } catch {
        if (!cancelled) setCostsLoaded(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const mergePasted = useCallback(
    (raw: string) => {
      if (!raw.trim()) {
        setStatus({ msg: 'Nothing pasted.', kind: 'error' });
        return false;
      }
      const parsed = parsePasted(raw);
      if (!parsed) {
        setStatus({ msg: 'Could not parse — copy the full TES_DATA output.', kind: 'error' });
        return false;
      }
      const { db: merged, added } = ingest(parsed, db);
      const colleges = new Set(merged.map((r) => r.college)).size;
      setDb(merged);
      setStatus({
        msg: `Added ${added.toLocaleString()} equivalencies. Total: ${merged.length.toLocaleString()} from ${colleges.toLocaleString()} institutions.`,
        kind: 'success',
      });
      return true;
    },
    [db],
  );

  return { db, costs, status, costsLoaded, mergePasted };
}
