import { useEffect, useState } from "react";

/**
 * Native minimize / maximize / close controls for the custom (decoration-less)
 * title bar. Collapsed to dots at rest, morphing to glyphs and widening on
 * hover — the dot span and glyph svg cross-fade via CSS driven by the --on
 * class. Rendered on both the workspace top bar and the login screen so users
 * are never trapped in a frameless window.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setMaximized(await win.isMaximized());
      });
    })().catch(() => {});
    return () => unlisten?.();
  }, []);

  const call = (action: "minimize" | "toggleMaximize" | "close") => async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()[action]();
  };

  const cls = `win-controls${hover ? " win-controls--on" : ""}`;
  const dot = <span className="win-dot" />;

  return (
    <div className={cls} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button className="win-btn" onClick={call("minimize")} title="Minimize">
        {dot}
        <svg className="win-glyph" width="11" height="11" viewBox="0 0 11 11" fill="none">
          <circle cx="2.2" cy="5.5" r="1.3" fill="currentColor" />
          <path d="M4.6 5.5h4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <span className="win-sep" />
      <button className="win-btn" onClick={call("toggleMaximize")} title={maximized ? "Restore" : "Maximize"}>
        {dot}
        <svg className="win-glyph" width="11" height="11" viewBox="0 0 11 11" fill="none">
          <circle cx="2.2" cy="2.2" r="1.3" fill="currentColor" />
          <path
            d={maximized ? "M3.6 3.6h5.2v5.2H3.6z M2.2 7V2.2H7" : "M2.2 2.2h6.6v6.6H2.2z"}
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>
      <span className="win-sep" />
      <button className="win-btn win-btn--close" onClick={call("close")} title="Close">
        {dot}
        <svg className="win-glyph" width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M2.4 2.4l6.2 6.2M8.6 2.4L2.4 8.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
