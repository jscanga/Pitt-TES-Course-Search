import { useEffect, useState } from 'react';
import type { RequirementModel } from './types';

export function useRequirementModel() {
  const [model, setModel] = useState<RequirementModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/requirements-cs-ds-2025.json');
        if (!res.ok) throw new Error('not found');
        const m = (await res.json()) as RequirementModel;
        if (!cancelled) setModel(m);
      } catch {
        if (!cancelled) setError('Requirement model failed to load.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { model, error };
}
