import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

type CopyState = "idle" | "copied" | "failed";

/** How long "Copied" (or "Couldn't copy") stays before the button reads "Copy" again. */
export const COPY_FEEDBACK_MS = 1600;

const LABELS: Record<CopyState, string> = { idle: "Copy", copied: "Copied", failed: "Couldn't copy" };

/**
 * A fenced code block in the reading view: its language in the corner and a
 * Copy button (#615) that appears on hover or keyboard focus and puts the
 * block's text on the clipboard. The text is read from the rendered block,
 * so it is exactly what is shown, without the language label.
 */
export function CodeBlock({ children, ...rest }: HTMLAttributes<HTMLPreElement> & { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // The fenced language sits on the child <code class="language-xxx">.
  const child = children as { props?: { className?: string } } | undefined;
  const lang = /language-(\w+)/.exec(child?.props?.className || "")?.[1];

  const copy = async () => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(preRef.current?.textContent ?? "");
    } catch {
      // No clipboard access (an unfocused window, a denied permission).
      next = "failed";
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
  };

  return (
    <div className="code-block">
      <div className="code-tools">
        {lang && <span className="code-lang">{lang}</span>}
        <button
          type="button"
          className={`code-copy${state === "idle" ? "" : ` code-copy--${state}`}`}
          onClick={copy}
          aria-label={state === "idle" ? "Copy code" : LABELS[state]}
        >
          {LABELS[state]}
        </button>
        {/* Announced once, without moving the focus off the button. */}
        <span className="code-copy-status" role="status">
          {state === "idle" ? "" : LABELS[state]}
        </span>
      </div>
      <pre ref={preRef} {...rest}>
        {children}
      </pre>
    </div>
  );
}
