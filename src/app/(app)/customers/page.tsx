import { Suspense } from "react";
import { CustomersScreen } from "./customers-screen";
import { ScreenLoading } from "@/components/ui";

// 認証必須画面。ブラウザでの認証状態に依存するためinstant検証は対象外。
export const instant = false;

export default function CustomersPage() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <CustomersScreen />
    </Suspense>
  );
}
