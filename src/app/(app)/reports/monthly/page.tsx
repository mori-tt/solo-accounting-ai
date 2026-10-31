import { Suspense } from "react";
import { MonthlyReportScreen } from "./monthly-report-screen";
import { ScreenLoading } from "@/components/ui";

// 認証必須画面。ブラウザでの認証状態に依存するためinstant検証は対象外。
export const instant = false;

export default function MonthlyReportPage() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <MonthlyReportScreen />
    </Suspense>
  );
}
