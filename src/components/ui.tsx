"use client";

import {
  useEffect,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { formatMonthKey, formatYen, shiftMonthKey } from "@/lib/format";

/** 共通UIプリミティブ。全画面で ローディング/エラー/空状態 を統一する。 */

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin text-indigo-600 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="読み込み中"
      role="status"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

export function LoadingBlock({ label = "読み込み中..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-zinc-500">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/** ページ全体のローディング */
export function ScreenLoading({ label }: { label?: string }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <LoadingBlock label={label} />
    </div>
  );
}

export function ErrorState({
  message = "データを取得できませんでした",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center dark:border-red-900/50 dark:bg-red-950/30">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">
        {message}
      </p>
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          再読み込み
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {title}
      </p>
      {description && (
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type AlertTone = "error" | "warning" | "info";

const alertTones: Record<AlertTone, string> = {
  error:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300",
};

export function Alert({
  tone = "info",
  children,
  className = "",
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${alertTones[tone]} ${className}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

type BadgeTone = "gray" | "green" | "amber" | "red" | "indigo" | "sky";

const badgeTones: Record<BadgeTone, string> = {
  gray: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  green:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  indigo:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};

export function Badge({
  tone = "gray",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-300 dark:disabled:bg-indigo-900",
  secondary:
    "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
  danger:
    "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-300 dark:disabled:bg-red-900",
  ghost:
    "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${buttonVariants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4 text-current" />}
      {children}
    </button>
  );
}

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      {children}
      {hint && !error && (
        <span className="mt-1 block text-xs text-zinc-400">{hint}</span>
      )}
      {error && (
        <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${inputClass} ${className}`} {...rest} />;
}

export function NumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      type="number"
      inputMode="numeric"
      className={`${inputClass} ${className}`}
      {...rest}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return <select className={`${inputClass} ${className}`} {...rest} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea className={`${inputClass} ${className}`} {...rest} />;
}

export function FileInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      type="file"
      className={`block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-50 dark:text-zinc-300 dark:file:border-zinc-700 dark:file:bg-zinc-800 dark:file:text-zinc-200 dark:hover:file:bg-zinc-700 ${className}`}
      {...rest}
    />
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * parseForm の issues("path: message" 形式)を表示用に整形する。
 * スキーマのメッセージ自体が項目名を含むため、トップレベルの
 * 英語パスは落とし、明細行などの配列パスだけ行番号を補う。
 */
export function formIssuesMessage(issues: string[]): string {
  return issues
    .map((issue) => {
      const sep = issue.indexOf(": ");
      if (sep === -1) return issue;
      const path = issue.slice(0, sep);
      const message = issue.slice(sep + 2);
      const parts = path.split(".");
      if (parts.length === 3 && Number.isInteger(Number(parts[1]))) {
        return `${Number(parts[1]) + 1}行目: ${message}`;
      }
      if (/^[a-zA-Z]+$/.test(path)) return message;
      return issue;
    })
    .join(" / ");
}

/** 月送りナビ(一覧・レポート画面で共用) */
export function MonthNav({
  monthKey,
  onChange,
}: {
  monthKey: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="secondary"
        onClick={() => onChange(shiftMonthKey(monthKey, -1))}
      >
        ← 前月
      </Button>
      <span className="min-w-24 text-center text-sm font-medium">
        {formatMonthKey(monthKey)}
      </span>
      <Button
        variant="secondary"
        onClick={() => onChange(shiftMonthKey(monthKey, 1))}
      >
        翌月 →
      </Button>
    </div>
  );
}

/** 金額表示。必ず ¥ 単位を明示する(整数円)。 */
export function Amount({
  value,
  className = "",
  colored = false,
}: {
  value: number;
  className?: string;
  colored?: boolean;
}) {
  const tone = colored
    ? value > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : value < 0
        ? "text-red-600 dark:text-red-400"
        : ""
    : "";
  return (
    <span className={`tabular-nums ${tone} ${className}`}>
      {formatYen(value)}
    </span>
  );
}

/** 破壊的操作・重要操作の確認ダイアログ */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "実行する",
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // portal先(document)はクライアントでのみ存在する
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          {message}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            キャンセル
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 一覧テーブルの共通クラス */
export const tableClass =
  "w-full border-collapse text-sm [&_th]:border-b [&_th]:border-zinc-200 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-zinc-500 dark:[&_th]:border-zinc-800 [&_td]:border-b [&_td]:border-zinc-100 [&_td]:px-3 [&_td]:py-2 dark:[&_td]:border-zinc-800";
