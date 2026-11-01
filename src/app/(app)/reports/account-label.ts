import { accountLabel } from "@/lib/accounts";
import { openingAccountLabel } from "@/lib/opening-balance-accounts";

/** 帳簿画面用の科目ラベル。現金・元入金・期首残高用資産コードなど科目マスタ外のコードをここで補う */
export function bookAccountLabel(code: string): string {
  const label = openingAccountLabel(code);
  return label !== code ? label : accountLabel(code);
}
