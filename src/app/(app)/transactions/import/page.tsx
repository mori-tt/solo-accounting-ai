import { Suspense } from "react";
import { BankImportScreen } from "./import-screen";
import { ScreenLoading } from "@/components/ui";

// 認証必須画面。ブラウザでの認証状態に依存するためinstant検証は対象外。
export const instant = false;

export default function TransactionsImportPage() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <BankImportScreen />
    </Suspense>
  );
}
