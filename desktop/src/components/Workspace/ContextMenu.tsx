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
  return (
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
    </div>
  );
}
