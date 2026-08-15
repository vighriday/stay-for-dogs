"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

/* ── Button ────────────────────────────────────────────────────
   Three kinds, no more. Focus is always bone — amber is reserved
   for the one thing that matters.                                */

type ButtonKind = "primary" | "secondary" | "quiet";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: ButtonKind;
  busy?: boolean;
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xs px-5 py-3 text-[14px] " +
  "font-medium transition-colors duration-[120ms] disabled:cursor-not-allowed " +
  "disabled:opacity-40 select-none";

const BUTTON_KIND: Record<ButtonKind, string> = {
  primary: "bg-bone text-ink hover:bg-white",
  secondary: "border border-line text-bone hover:border-line-bright hover:bg-ink-raised",
  quiet: "px-0 py-1 text-dim hover:text-bone underline underline-offset-4 decoration-line",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { kind = "primary", busy, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${BUTTON_BASE} ${BUTTON_KIND[kind]} ${className}`}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-current border-t-transparent"
    />
  );
}

/* ── Field ─────────────────────────────────────────────────────
   Mono label above, error below. No floating labels, no magic.   */

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  mono?: boolean;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, mono, className = "", ...rest },
  ref,
) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={`rounded-xs ${mono ? "font-mono text-[13px]" : ""} ${
          error ? "border-clay" : ""
        } ${className}`}
        {...rest}
      />
      {error ? (
        <p id={`${id}-err`} className="text-[13px] text-clay">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-dim">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

/* ── Chip list ─────────────────────────────────────────────────
   Used for the things a dog likes and the words it must never hear. */

export function ChipInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
  max = 12,
  tone = "neutral",
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
  tone?: "neutral" | "warn";
}) {
  const [draft, setDraft] = useState("");
  const id = useId();

  const add = () => {
    const v = draft.trim().replace(/,$/, "");
    if (!v) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setDraft("");
      return;
    }
    if (values.length >= max) return;
    onChange([...values, v]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="label">
        {label}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {values.map((v) => (
          <span
            key={v}
            className={`inline-flex items-center gap-2 rounded-xs border px-2.5 py-1.5 text-[13px] ${
              tone === "warn"
                ? "border-clay/40 bg-clay/10 text-clay"
                : "border-line bg-ink-raised text-bone"
            }`}
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              className="text-dim transition-colors hover:text-bone"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
            if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          placeholder={placeholder}
          disabled={values.length >= max}
          className="rounded-xs"
        />
        <Button kind="secondary" type="button" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      {hint && <p className="text-[13px] text-dim">{hint}</p>}
    </div>
  );
}

/* ── Slider ────────────────────────────────────────────────────
   Hairline track, square thumb, live value in mono.               */

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <span className="mono text-dim">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="stay-slider"
      />
    </div>
  );
}

/* ── Notice ────────────────────────────────────────────────────
   Inline, quiet, never a modal. Degraded states are information,
   not interruptions.                                              */

export function Notice({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warn" | "good";
  children: ReactNode;
}) {
  const border =
    tone === "warn" ? "border-lamp/30" : tone === "good" ? "border-moss/40" : "border-line";
  const dot = tone === "warn" ? "bg-lamp" : tone === "good" ? "bg-moss" : "bg-dim";

  return (
    <div
      className={`flex items-start gap-3 border ${border} bg-ink-raised px-4 py-3 text-[13px] text-dim`}
    >
      <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="[&_strong]:font-medium [&_strong]:text-bone">{children}</div>
    </div>
  );
}

/* ── Toast ─────────────────────────────────────────────────────── */

export function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!message) return;
    timer.current = setTimeout(onDismiss, 5000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      className="fixed bottom-6 left-6 z-50 flex max-w-sm items-start gap-3 border border-line bg-ink-raised px-4 py-3 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
    >
      <span className="flex-1">{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-dim transition-colors hover:text-bone"
      >
        ×
      </button>
    </div>
  );
}

/* ── Section ───────────────────────────────────────────────────── */

export function Section({
  step,
  title,
  children,
}: {
  step?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {step && <span className="label">{step}</span>}
        <h2 className="display text-[28px] text-bone">{title}</h2>
      </div>
      {children}
    </section>
  );
}
