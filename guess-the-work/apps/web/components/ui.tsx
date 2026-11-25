"use client";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";
import { Icon } from "@/lib/icons";

export function Avatar({ name, color, icon, size = 32 }: { name: string; color?: string; icon?: string; size?: number }) {
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-sm" style={{ width: size, height: size, background: `${color ?? "#9C978E"}22`, color: color ?? "#9C978E", boxShadow: `inset 0 0 0 1px ${color ?? "#9C978E"}55` }} title={name}>
      {icon ? <Icon name={icon} size={Math.round(size * 0.55)} /> : <span className="text-sm font-semibold">{name.slice(0, 1)}</span>}
    </span>
  );
}

/** Animated number (score). */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("en-US"));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.7, ease: "easeOut" });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span className={`num ${className ?? ""}`}>{text}</motion.span>;
}

export function PageTitle({ kicker, title, children }: { kicker?: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6 space-y-2">
      {kicker && <div className="label">{kicker}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">{title}</h1>
        {children}
      </div>
      <div className="rule" />
    </header>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton ${className ?? ""}`} />;
}

export function Empty({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="panel flex flex-col items-center gap-3 px-6 py-12 text-center">
      <Icon name={icon} size={36} className="text-faint" strokeWidth={1.2} />
      <div className="font-display text-xl">{title}</div>
      {text && <p className="max-w-sm text-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ text, onClose }: { text: string; onClose?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-text">
      <Icon name="AlertTriangle" className="text-signal" />
      <span className="flex-1">{text}</span>
      {onClose && (
        <button onClick={onClose} aria-label="close" className="text-muted hover:text-text">
          <Icon name="X" size={16} />
        </button>
      )}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded border border-line bg-surface2 p-1">
      {options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`inline-flex h-9 items-center gap-2 rounded-sm px-3 text-sm transition-colors ${o.value === value ? "bg-accent text-accentInk" : "text-muted hover:text-text"}`}
        >
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Animated sound waves (audio modes). */
export function Waveform({ playing = true, bars = 28 }: { playing?: boolean; bars?: number }) {
  return (
    <div className="flex h-20 items-center justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const base = 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6));
        return (
          <motion.span
            key={i}
            className="w-[3px] rounded-full bg-accent"
            style={{ height: 72, originY: 0.5 }}
            initial={{ scaleY: base * 0.4 }}
            animate={playing ? { scaleY: [base * 0.3, base, base * 0.5, base * 0.85, base * 0.3] } : { scaleY: 0.08 }}
            transition={playing ? { duration: 1.1 + (i % 5) * 0.13, repeat: Infinity, ease: "easeInOut", delay: (i % 7) * 0.05 } : { duration: 0.4 }}
          />
        );
      })}
    </div>
  );
}
