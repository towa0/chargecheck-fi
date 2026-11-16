import { useEffect, useRef, useState } from 'react';

/**
 * Text for a polite live region. It only changes when `trigger` changes, and only after
 * `delayMs` of quiet, so fast typing or background updates don't flood screen readers.
 */
export function useAnnouncement(text: string, trigger: string, delayMs: number): string {
  const [announced, setAnnounced] = useState('');
  const latest = useRef(text);
  latest.current = text;

  useEffect(() => {
    const id = setTimeout(() => setAnnounced(latest.current), delayMs);
    return () => clearTimeout(id);
  }, [trigger, delayMs]);

  return announced;
}
