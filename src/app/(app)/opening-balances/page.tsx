import { Suspense } from "react";
import { OpeningBalancesScreen } from "./opening-balances-screen";
import { ScreenLoading } from "@/components/ui";

// 認証必須画面。ブラウザでの認証状態に依存するためinstant検証は対象外。
export const instant = false;

export default function OpeningBalancesPage() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <OpeningBalancesScreen />
    </Suspense>
  );
}
