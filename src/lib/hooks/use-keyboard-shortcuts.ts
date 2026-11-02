"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/** ショートカットの表示定義(「?」一覧ダイアログの並び順) */
export const KEYBOARD_SHORTCUTS: readonly {
  keys: string;
  label: string;
}[] = [
  { keys: "g → d", label: "ダッシュボードへ移動" },
  { keys: "g → t", label: "取引一覧へ移動" },
  { keys: "n", label: "取引を新規登録(取引一覧の登録フォームを開く)" },
  { keys: "/", label: "検索へ移動してキーワード欄にフォーカス" },
  { keys: "?", label: "ショートカット一覧を表示" },
];

/** 検索画面のキーワード入力を特定する属性セレクタ */
export const SEARCH_INPUT_SELECTOR = "input[data-shortcut='search-input']";

/** 「g」の2ストローク前置キーの有効時間 */
const GOTO_PREFIX_TIMEOUT_MS = 1000;

function focusSearchInput(): void {
  document.querySelector<HTMLElement>(SEARCH_INPUT_SELECTOR)?.focus();
}

/** 入力欄・選択肢・contentEditable 上のキー入力はショートカットにしない */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

export interface KeyboardShortcutsState {
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}

/**
 * アプリ全体のキーボードショートカット。
 * (app)/layout.tsx で KeyboardShortcuts 経由でマウントする。
 * viewerロールには新規登録ショートカット(n)を適用しない。
 */
export function useKeyboardShortcuts(options?: {
  enabled?: boolean;
  canEdit?: boolean;
}): KeyboardShortcutsState {
  const enabled = options?.enabled ?? true;
  const canEdit = options?.canEdit ?? true;
  const router = useRouter();
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);
  // 「/」で /search へ遷移する際、到着後にフォーカスするためのフラグ
  const focusSearchOnArrival = useRef(false);

  useEffect(() => {
    if (!focusSearchOnArrival.current || pathname !== "/search") return;
    focusSearchOnArrival.current = false;
    focusSearchInput();
  }, [pathname]);

  useEffect(() => {
    if (!enabled) return;
    let gotoPending = false;
    let gotoTimer: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      if (gotoPending) {
        gotoPending = false;
        clearTimeout(gotoTimer);
        if (e.key === "d") {
          e.preventDefault();
          router.push("/dashboard");
          return;
        }
        if (e.key === "t") {
          e.preventDefault();
          router.push("/transactions");
          return;
        }
        // 対応しないキーは通常のショートカット判定へフォールスルー
      }

      switch (e.key) {
        case "g":
          gotoPending = true;
          gotoTimer = setTimeout(() => {
            gotoPending = false;
          }, GOTO_PREFIX_TIMEOUT_MS);
          break;
        case "n":
          e.preventDefault();
          // viewerは登録不可のためフォーム起動パラメータを付けない
          router.push(canEdit ? "/transactions?new=1" : "/transactions");
          break;
        case "/":
          e.preventDefault();
          if (pathname === "/search") {
            focusSearchInput();
          } else {
            focusSearchOnArrival.current = true;
            router.push("/search");
          }
          break;
        case "?":
          e.preventDefault();
          setHelpOpen((v) => !v);
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(gotoTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, canEdit, router, pathname]);

  return { helpOpen, setHelpOpen };
}
