import { useState, type ReactNode } from "react";
import type { Health, Severity } from "./model";

export function Icon({ name, className }: { name: string; className?: string }) {
  return <span className={`codicon codicon-${name}${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}

export type Tone = "ok" | "warning" | "error" | "info" | "neutral";

export function toneOfHealth(health: Health): Tone {
  return health === "inactive" ? "neutral" : health;
}

export function toneOfSeverity(severity: Severity): Tone {
  return severity;
}

export function StatusDot({ tone, pulse = false, label }: { tone: Tone; pulse?: boolean; label?: string }) {
  return (
    <span
      className={`obs-dot obs-tone-${tone}${pulse ? " obs-dot-pulse" : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`obs-badge obs-tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Card({
  title,
  icon,
  actions,
  children,
  className,
  flush = false
}: {
  title?: ReactNode;
  icon?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`obs-card${flush ? " obs-card-flush" : ""}${className ? ` ${className}` : ""}`}>
      {(title || actions) && (
        <header className="obs-card-header">
          <h3>
            {icon && <Icon name={icon} />}
            {title}
          </h3>
          {actions && <div className="obs-card-actions">{actions}</div>}
        </header>
      )}
      <div className="obs-card-body">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone,
  icon,
  children,
  onClick
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: string;
  children?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="obs-stat-label">
        {icon && <Icon name={icon} />}
        {label}
      </span>
      <span className={`obs-stat-value${tone ? ` obs-tone-text-${tone}` : ""}`}>{value}</span>
      {sub && <span className="obs-stat-sub">{sub}</span>}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className="obs-stat obs-stat-clickable" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="obs-stat">{content}</div>
  );
}

/** A filled bar of `value / max`; tone shifts to warning and error as it fills. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const tone: Tone = ratio >= 0.9 ? "error" : ratio >= 0.75 ? "warning" : "ok";
  return (
    <div
      className="obs-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div className={`obs-meter-fill obs-tone-bg-${tone}`} style={{ width: `${(ratio * 100).toFixed(1)}%` }} />
    </div>
  );
}

/** A small trend line. Gaps (undefined) break the line rather than dropping to zero. */
export function Sparkline({ values, max, label }: { values: readonly (number | undefined)[]; max?: number; label: string }) {
  const width = 120;
  const height = 28;
  const defined = values.filter((value): value is number => value !== undefined);
  if (defined.length < 2) {
    return <svg className="obs-sparkline" width={width} height={height} role="img" aria-label={`${label}: collecting samples`} />;
  }
  const top = Math.max(max ?? 0, ...defined) || 1;
  const step = width / Math.max(1, values.length - 1);
  const segments: string[] = [];
  let current = "";
  values.forEach((value, index) => {
    if (value === undefined) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    const x = (index * step).toFixed(1);
    const y = (height - 2 - (value / top) * (height - 4)).toFixed(1);
    current += `${current ? "L" : "M"}${x},${y}`;
  });
  if (current) segments.push(current);
  const last = defined[defined.length - 1];
  return (
    <svg className="obs-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: latest ${last}`}>
      {segments.map((path, index) => (
        <path key={index} d={path} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="obs-search">
      <Icon name="search" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
          }
        }}
      />
    </label>
  );
}

export type ChipOption<T extends string> = { value: T; label: string; count?: number; tone?: Tone };

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="obs-chips" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`obs-chip${value === option.value ? " obs-chip-active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.tone && <StatusDot tone={option.tone} />}
          {option.label}
          {option.count !== undefined && <span className="obs-chip-count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="obs-empty">
      <Icon name={icon} />
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

export function KeyValueGrid({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="obs-kv">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code className="obs-mono" title={title}>
      {children}
    </code>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: () => string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="obs-button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text())
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      {copied ? "Copied" : label}
    </button>
  );
}
