import { useCallback, useEffect, useState } from 'react';

const toastMs = 2500;

/** One toast at a time; it clears itself after 2.5 s. */
export function useToast(): {
  readonly message: string | null;
  readonly id: number;
  readonly show: (message: string) => void;
} {
  const [toast, setToast] = useState<{ message: string | null; id: number }>({
    message: null,
    id: 0,
  });
  useEffect(() => {
    if (toast.message === null) return undefined;
    const timer = setTimeout(() => {
      setToast((current) => (current.id === toast.id ? { ...current, message: null } : current));
    }, toastMs);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);
  const show = useCallback((message: string) => {
    setToast((current) => ({ message, id: current.id + 1 }));
  }, []);
  return { message: toast.message, id: toast.id, show };
}
