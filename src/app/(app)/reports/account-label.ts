import { CASH_ACCOUNT } from "@/lib/accounting/domain/ledger";
import { accountLabel } from "@/lib/accounts";

/** 帳簿画面用の科目ラベル。現金勘定は科目マスタ未登録の内部コードなのでここで補う */
export function bookAccountLabel(code: string): string {
  return code === CASH_ACCOUNT ? "現金" : accountLabel(code);
}
