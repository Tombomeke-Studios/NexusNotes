import { createPortal } from "react-dom";
import "./Workspace.css";

export interface ContextMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  // Portal to the body so the menu is never offset or clipped by a transformed
  // or scrolling ancestor (e.g. when opened from inside the sidebar panel).
  return createPortal(
    <div
      className="ctx-overlay"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
        {items.map((item) => (
          <button
            key={item.key}
            className={`ctx-item${item.danger ? " ctx-item--danger" : ""}`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
