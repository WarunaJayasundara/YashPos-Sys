import { useEffect, useState } from 'react';
import { listPending, type PendingSale } from './offline';

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function usePending() {
  const [items, setItems] = useState<PendingSale[]>([]);
  useEffect(() => {
    const load = () => listPending().then(setItems).catch(() => setItems([]));
    load();
    window.addEventListener('yash:pending-changed', load);
    return () => window.removeEventListener('yash:pending-changed', load);
  }, []);
  return items;
}
