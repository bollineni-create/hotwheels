import { useEffect, useState } from 'react';

// Run an async load whenever `key` changes. The result is tied to the key it was loaded for,
// so a screen shows "loading" for a new key without resetting state inside the effect.
export function useAsync<T>(run: () => Promise<T>, key: string) {
  const [st, setSt] = useState<{ key: string; data?: T; error?: unknown } | null>(null);
  useEffect(() => {
    let alive = true;
    // A tick first, so the screen paints before heavy work (the demo market builds on first use).
    const t = setTimeout(() => {
      run().then((data) => alive && setSt({ key, data }), (error) => alive && setSt({ key, error: error ?? new Error('Failed') }));
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = st && st.key === key ? st : null;
  return { data: cur?.data, error: cur?.error, loading: !cur };
}
