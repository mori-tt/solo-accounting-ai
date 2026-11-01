import { CASH_ACCOUNT } from "@/lib/accounting/domain/ledger";
import { useAccounts } from "@/lib/hooks/use-accounts";

/**
 * 帳簿画面用の科目ラベル解決。
 * 現金勘定は科目マスタ未登録の内部コードなのでここで補う。
 * カスタム科目は useAccounts 経由で解決される。
 */
export function useBookAccountLabel(): (code: string) => string {
  const { label } = useAccounts();
  return (code: string) => (code === CASH_ACCOUNT ? "現金" : label(code));
}
