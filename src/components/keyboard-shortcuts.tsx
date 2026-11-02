"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useApp } from "./auth-provider";
import { Button } from "./ui";
import {
  KEYBOARD_SHORTCUTS,
  useKeyboardShortcuts,
} from "@/lib/hooks/use-keyboard-shortcuts";

/**
 * アプリ共通のキーボードショートカット。
 * (app)/layout.tsx でマウントし、「?」で一覧ダイアログを開閉する。
 */
export function KeyboardShortcuts() {
  const { status, business } = useApp();
  const { helpOpen, setHelpOpen } = useKeyboardShortcuts({
    enabled: status === "signed_in",
    canEdit: business?.role !== "viewer",
  });
  // portal先(document)はクライアントでのみ存在する
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const titleId = useId();

  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, setHelpOpen]);

  if (!helpOpen || !mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold">
          キーボードショートカット
        </h2>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {KEYBOARD_SHORTCUTS.map((s) => (
              <tr
                key={s.keys}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
              >
                <td className="whitespace-nowrap py-2 pr-3">
                  <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-800">
                    {s.keys}
                  </kbd>
                </td>
                <td className="py-2 text-zinc-600 dark:text-zinc-300">
                  {s.label}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-zinc-400">
          入力欄にフォーカスしている間はショートカットは動作しません
        </p>
        <div className="mt-4 flex justify-end">
          <Button
            variant="secondary"
            onClick={() => setHelpOpen(false)}
            autoFocus
          >
            閉じる
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
