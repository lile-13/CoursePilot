import { useEffect, useState } from 'react';
import { getBeijingNow } from './lib/time.js';

export function useBeijingNow(interval = 1000) {
  const [now, setNow] = useState(() => getBeijingNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(getBeijingNow()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}
