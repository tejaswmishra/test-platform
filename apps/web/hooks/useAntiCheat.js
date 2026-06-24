import { useEffect, useRef, useCallback } from 'react';

// Watches the browser for tab-switches, window blur, and page close.
// Calls onAutoSubmit(reason) when a genuine violation is detected.
// Calls onPopupWarning(message) for brief blurs likely caused by
// OS-level popups (battery warning, wifi notification) — these should
// NOT trigger a submit, just a gentle on-screen warning.
export function useAntiCheat({ isActive, onAutoSubmit, onPopupWarning }) {
  const blurTimeRef = useRef(null);
  const hasTriggeredRef = useRef(false);
  const POPUP_THRESHOLD_MS = 1500;

  const triggerSubmit = useCallback((reason) => {
    if (hasTriggeredRef.current) return; // only ever fire once
    hasTriggeredRef.current = true;
    onAutoSubmit(reason);
  }, [onAutoSubmit]);

  useEffect(() => {
    if (!isActive) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        triggerSubmit('tab_switch');
      }
    };

    const handleBlur = () => {
      blurTimeRef.current = Date.now();
    };

    const handleFocus = () => {
      if (!blurTimeRef.current) return;
      const blurDuration = Date.now() - blurTimeRef.current;
      blurTimeRef.current = null;

      if (blurDuration < POPUP_THRESHOLD_MS) {
        onPopupWarning('A system popup appeared. Please stay on this page.');
      } else {
        triggerSubmit('new_window');
      }
    };

    const handleBeforeUnload = (e) => {
      triggerSubmit('page_close');
      e.preventDefault();
      e.returnValue = '';
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isActive, triggerSubmit, onPopupWarning]);
}
