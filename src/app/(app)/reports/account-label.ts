import { CASH_ACCOUNT } from "@/lib/accounting/domain/ledger";
import { useAccounts } from "@/lib/hooks/use-accounts";
import { openingAccountLabel } from "@/lib/opening-balance-accounts";

/**
 * 帳簿画面用の科目ラベル解決。
 * 現金・元入金・期首残高用資産コードなど科目マスタ外のコードをここで補う。
 * カスタム科目は useAccounts 経由で解決される。
 */
export function useBookAccountLabel(): (code: string) => string {
  const { label } = useAccounts();
  return (code: string) => {
    if (code === CASH_ACCOUNT) return "現金";
    const opening = openingAccountLabel(code);
    return opening !== code ? opening : label(code);
  };
}
