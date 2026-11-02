import type { ReactNode } from "react";

/** 条項セクションの骨組み */
export function Clause({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-7 text-zinc-600 dark:text-zinc-300">
        {children}
      </div>
    </section>
  );
}

/** 本文未作成・公開前に法務確認が必要な箇所のプレースホルダー注記 */
export function ReviewNote({ note }: { note?: string }) {
  return (
    <p className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
      【要法務レビュー】{note ?? "本項の本文は未作成です。公開前に法務確認が必要です。"}
    </p>
  );
}
