import { useEffect, useRef, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { dismissToast, getToasts, subscribeToasts, type Toast } from "../lib/toast";
import { duration, ease, exitDuration, spring } from "../lib/motion-tokens";
import "./Toaster.css";

/**
 * Toast stack in the bottom-right corner (#429). Toasts slide in from the
 * corner, leave on their own after a few seconds (paused while hovered or
 * focused) and shrink away on exit.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  return (
    <div className="toaster" role="region" aria-label="Notifications">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => dismissToast(toast.id), toast.duration);
  };
  const pause = () => clearTimeout(timer.current);

  useEffect(() => {
    start();
    return pause;
    // One timer per toast; restarted only by pointer/focus leaving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  return (
    <motion.div
      layout
      className={`toast toast--${toast.kind}`}
      role={toast.kind === "error" ? "alert" : "status"}
      initial={{ opacity: 0, x: 24, y: 12 }}
      animate={{ opacity: 1, x: 0, y: 0, transition: spring.snappy }}
      exit={{ opacity: 0, scale: 0.86, transition: { duration: exitDuration(duration.base), ease: ease.in } }}
      transition={{ layout: { duration: duration.base, ease: ease.out } }}
      onMouseEnter={pause}
      onMouseLeave={start}
      onFocus={pause}
      onBlur={start}
    >
      <span className="toast-icon" aria-hidden="true" />
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)}>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </motion.div>
  );
}
