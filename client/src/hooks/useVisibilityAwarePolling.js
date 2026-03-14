import { useEffect, useRef, useCallback } from 'react';

/**
 * Runs `callback` on an interval but pauses when the tab is hidden and
 * immediately re-fetches (with a 300ms delay for iOS 18 Safari) when it
 * becomes visible again.
 *
 * This prevents:
 *  - Wasted battery from polling while the phone screen is off
 *  - Piled-up failed requests on iOS when the tab is backgrounded
 *  - Stale data when the user returns after a long pause
 */
export function useVisibilityAwarePolling(callback, intervalMs) {
  const intervalRef = useRef(null);
  // Always call the latest version of callback without resetting the interval
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; }, [callback]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (intervalRef.current) return; // already running
    intervalRef.current = setInterval(() => callbackRef.current(), intervalMs);
  }, [intervalMs]);

  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) {
        stop();
      } else {
        // iOS 18 Safari bug: fetch() fails if called synchronously inside
        // visibilitychange. A 300ms delay is enough for Safari to reinitialize
        // its network stack.
        setTimeout(() => callbackRef.current(), 300);
        start();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);

    // Also re-fetch when network comes back (WiFi → cellular, reconnect)
    function handleOnline() {
      setTimeout(() => callbackRef.current(), 300);
    }
    window.addEventListener('online', handleOnline);

    // Start immediately if the tab is already visible
    if (!document.hidden) start();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      stop();
    };
  }, [start, stop]);
}
