import {
  CASH_ACCOUNT,
  OPENING_EQUITY_ACCOUNT,
  WITHHOLDING_ACCOUNT,
} from "@/lib/accounting/domain/ledger";

/**
 * 期首残高の設定対象となる資産科目の選択肢。
 * 現金は取引展開と同じ内部コード、預金・売掛金は期首残高導入に
 * あわせて追加した帳簿用コード(accounts.ts の科目マスタは別管理)。
 * 預り金(源泉所得税)は未納付残高を繰り越す負債科目。
 * これ以外のコードも自由入力で登録できる(カスタム科目)。
 */
export const OPENING_BALANCE_ACCOUNT_OPTIONS: readonly {
  code: string;
  label: string;
}[] = [
  { code: CASH_ACCOUNT, label: "現金" },
  { code: "deposits", label: "預金" },
  { code: "receivables", label: "売掛金" },
  { code: WITHHOLDING_ACCOUNT, label: "預り金(源泉所得税)" },
];

const labelMap = new Map<string, string>([
  ...OPENING_BALANCE_ACCOUNT_OPTIONS.map(
    (a) => [a.code, a.label] as [string, string],
  ),
  [OPENING_EQUITY_ACCOUNT, "元入金"],
]);

/** 期首残高・帳簿関連コードの表示名。未定義コードはそのまま返す */
export function openingAccountLabel(code: string): string {
  return labelMap.get(code) ?? code;
}
