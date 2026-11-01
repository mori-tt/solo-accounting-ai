/**
 * 勘定科目マスタ(初期版)。
 * Transaction.account に保存するコードと表示名の対応。
 * 正式な科目体系の整備はドメイン側の課題。UIではこの一覧を使う。
 */

export interface AccountOption {
  code: string;
  label: string;
  /** 主に使う取引種別 */
  kind: "income" | "expense" | "any";
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
  { code: "misc_expense", label: "雑費", kind: "expense" },
  { code: "transfer", label: "振替・口座間移動", kind: "any" },
  { code: "other", label: "その他", kind: "any" },
] as const;

const accountLabelMap = new Map(ACCOUNT_OPTIONS.map((a) => [a.code, a.label]));

/** 科目コード → 表示名。未定義コードはそのまま返す */
export function accountLabel(code: string): string {
  return accountLabelMap.get(code) ?? code;
}

/** 取引種別に合わせた科目選択肢 */
export function accountOptionsFor(
  kind: "income" | "expense" | "transfer",
): readonly AccountOption[] {
  if (kind === "transfer") {
    return ACCOUNT_OPTIONS.filter((a) => a.kind === "any");
  }
  return ACCOUNT_OPTIONS.filter((a) => a.kind === kind || a.kind === "any");
}
