import { motion } from "framer-motion";
import { spring } from "../../lib/motion-tokens";

/** Segmented choice with a pill that glides to the selected option. */
export function Segmented<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            className={`settings-seg-btn${on ? " settings-seg-btn--on" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {on && <motion.span layoutId={`seg-pill-${id}`} className="settings-seg-pill" transition={spring.snappy} />}
            <span className="settings-seg-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
