import type { CustomAccount } from "@/lib/accounting/types";

/**
 * 勘定科目マスタ(初期版)。
 * Transaction.account に保存するコードと表示名の対応。
 * 正式な科目体系の整備はドメイン側の課題。UIではこの一覧を使う。
 * 事業ごとのカスタム科目は Business.customAccounts を
 * getAccountOptions でマージして解決する。
 */

export interface AccountOption {
  code: string;
  label: string;
  /** 主に使う取引種別 */
  kind: "income" | "expense" | "any";
  /** 補助科目の場合の親科目コード(カスタム科目のみ) */
  parentCode?: string;
  /** 無効化済み。新規選択肢・CSV照合からは外すがラベル解決は維持する */
  disabled?: boolean;
}

export const ACCOUNT_OPTIONS: readonly AccountOption[] = [
  { code: "sales", label: "売上高", kind: "income" },
  { code: "misc_income", label: "雑収入", kind: "income" },
  { code: "purchases", label: "仕入高", kind: "expense" },
  { code: "supplies", label: "消耗品費", kind: "expense" },
  { code: "communication", label: "通信費", kind: "expense" },
  { code: "travel", label: "旅費交通費", kind: "expense" },
  { code: "entertainment", label: "接待交際費", kind: "expense" },
  { code: "meeting", label: "会議費", kind: "expense" },
  { code: "advertising", label: "広告宣伝費", kind: "expense" },
  { code: "rent", label: "地代家賃", kind: "expense" },
  { code: "utilities", label: "水道光熱費", kind: "expense" },
  { code: "fees", label: "支払手数料", kind: "expense" },
  { code: "outsourcing", label: "外注費", kind: "expense" },
  { code: "insurance", label: "保険料", kind: "expense" },
  { code: "taxes", label: "租税公課", kind: "expense" },
  { code: "dues", label: "諸会費", kind: "expense" },
  { code: "family_salary", label: "専従者給与", kind: "expense" },
  { code: "misc_expense", label: "雑費", kind: "expense" },
  { code: "depreciation", label: "減価償却費", kind: "expense" },
  { code: "transfer", label: "振替・口座間移動", kind: "any" },
  { code: "other", label: "その他", kind: "any" },
] as const;

/**
 * 標準科目に事業のカスタム科目をマージした科目一覧。
 * 科目解決はこの関数を経由する(フォーム選択肢・AI候補・CSV照合・表示名)。
 * 標準科目と同じコード、または重複したコードのカスタム科目は無視する。
 * 無効化された科目も一覧には含める(既存取引のラベル解決のため)。
 */
export function getAccountOptions(
  business?: { customAccounts?: CustomAccount[] } | null,
): AccountOption[] {
  const custom = business?.customAccounts ?? [];
  const merged: AccountOption[] = [...ACCOUNT_OPTIONS];
  if (custom.length === 0) return merged;
  const seen = new Set(merged.map((a) => a.code));
  for (const c of custom) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    merged.push({
      code: c.code,
      label: c.label,
      kind: c.kind,
      ...(c.parentCode ? { parentCode: c.parentCode } : {}),
      ...(c.disabled ? { disabled: true } : {}),
    });
  }
  return merged;
}

const accountLabelMap = new Map(ACCOUNT_OPTIONS.map((a) => [a.code, a.label]));

/** 科目コード → 表示名。未定義コードはそのまま返す */
export function accountLabel(code: string): string {
  return accountLabelMap.get(code) ?? code;
}

/** options 内の科目コード → 表示名。未定義コードはそのまま返す */
export function accountLabelIn(
  options: readonly AccountOption[],
  code: string,
): string {
  return options.find((a) => a.code === code)?.label ?? code;
}

/** 取引種別に合わせた科目選択肢。無効化された科目は除く */
export function accountOptionsFor(
  kind: "income" | "expense" | "transfer",
  options: readonly AccountOption[] = ACCOUNT_OPTIONS,
): AccountOption[] {
  const active = options.filter((a) => !a.disabled);
  if (kind === "transfer") {
    return active.filter((a) => a.kind === "any");
  }
  return active.filter((a) => a.kind === kind || a.kind === "any");
}
