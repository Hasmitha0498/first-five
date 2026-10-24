import clsx from "clsx";
import { AlertCircle, Check, CheckCircle2, Copy, Info, Loader2, TriangleAlert, type LucideIcon } from "lucide-react";
import {
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link, NavLink, type LinkProps } from "react-router-dom";

// ───────────────────────────── Buttons ─────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
const variants: Record<Variant, string> = {
  primary: "bg-deep text-white hover:bg-deep-hover shadow-cta",
  secondary: "bg-surface text-ink border border-[#C9D9D3] hover:border-accent",
  ghost: "text-ink-soft hover:bg-slate-100 hover:text-ink",
  danger: "bg-surface text-danger border border-red-200 hover:bg-danger-soft",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-[50px] px-5 text-[15px]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return clsx(buttonBase, variants[variant], sizes[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon: Icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
});

export function LinkButton({ variant = "primary", size = "md", className, icon: Icon, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: LucideIcon }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {Icon && <Icon className="h-4 w-4" aria-hidden />}
      {children}
    </Link>
  );
}

// ───────────────────────────── Surfaces ─────────────────────────────

export function Card({ className, children, as: As = "div" }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" }) {
  return <As className={clsx("rounded-xl border border-line bg-surface shadow-card", className)}>{children}</As>;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, action, eyebrow }: { title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        {eyebrow && <div className="mb-2 text-sm text-ink-muted">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
      )}
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {description && <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

// ───────────────────────────── Feedback ─────────────────────────────

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
const pillTones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  accent: "bg-accent-soft text-accent-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-sky-50 text-sky-800",
};

export function Pill({ tone = "neutral", children, dot = false, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", pillTones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

const alertStyles: Record<Exclude<Tone, "neutral" | "accent">, { box: string; icon: LucideIcon }> = {
  info: { box: "border-sky-200 bg-sky-50 text-sky-900", icon: Info },
  success: { box: "border-green-200 bg-success-soft text-green-900", icon: CheckCircle2 },
  warning: { box: "border-amber-200 bg-warning-soft text-amber-900", icon: TriangleAlert },
  danger: { box: "border-red-200 bg-danger-soft text-red-900", icon: AlertCircle },
};

export function Alert({ tone = "info", title, children, action, className }: { tone?: keyof typeof alertStyles; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const s = alertStyles[tone];
  const Icon = s.icon;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={clsx("flex gap-3 rounded-lg border px-4 py-3 text-sm", s.box, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={clsx("leading-relaxed", title && "mt-0.5 opacity-90")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-muted" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span>{label}…</span>
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <Spinner />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="p-6">
      <Alert tone="danger" title="We couldn't load this" action={onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}>
        {message}
      </Alert>
    </Card>
  );
}

// ───────────────────────────── Forms ─────────────────────────────

export function Field({
  label,
  hint,
  error,
  children,
  id,
  optional,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
  id?: string;
  optional?: boolean;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-error` : undefined;
  return (
    <div>
      <label htmlFor={fid} className="mb-1.5 flex items-baseline gap-2 text-sm font-medium text-ink">
        {label}
        {optional && <span className="text-xs font-normal text-ink-muted">Optional</span>}
      </label>
      {children({ id: fid, "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="mt-1.5 flex items-center gap-1 text-sm text-danger">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "block w-full rounded-lg border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-slate-400 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-slate-50 disabled:text-ink-muted aria-[invalid=true]:border-red-400";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(inputClass, "h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(inputClass, "py-2 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(inputClass, "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

// ───────────────────────────── Copy & code ─────────────────────────────

export function useCopy(timeout = 2000) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), timeout);
  };
  return { copied, copy };
}

export function CopyButton({ text, label = "Copy", copiedLabel = "Copied", variant = "secondary", size = "sm", onCopied, className }: { text: string; label?: string; copiedLabel?: string; variant?: Variant; size?: Size; onCopied?: () => void; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      icon={copied ? Check : Copy}
      onClick={async () => {
        await copy(text);
        onCopied?.();
      }}
      aria-live="polite"
    >
      {copied ? copiedLabel : label}
    </Button>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <pre aria-label={label} className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0F1720] p-4 font-mono text-[13px] leading-relaxed text-slate-100">
      <code>{code}</code>
    </pre>
  );
}

// ───────────────────────────── Data display ─────────────────────────────

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "success" | "warning" | "neutral" }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-ink-muted">{label}</div>
      <div className={clsx("mt-1 text-3xl font-semibold tabular-nums tracking-tight", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-ink")}>{value}</div>
      {sub && <div className="mt-1 text-sm text-ink-muted">{sub}</div>}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-ink-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words font-medium text-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ tabs }: { tabs: { to: string; label: string; end?: boolean; count?: number }[] }) {
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            clsx(
              "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              isActive ? "border-accent text-accent-ink" : "border-transparent text-ink-muted hover:border-slate-300 hover:text-ink",
            )
          }
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-ink-muted">{t.count}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
