import { Suspense } from "react";
import { ClosingScreen } from "./closing-screen";
import { ScreenLoading } from "@/components/ui";

// 認証必須画面。ブラウザでの認証状態に依存するためinstant検証は対象外。
export const instant = false;

export default function ClosingPage() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <ClosingScreen />
    </Suspense>
  );
}
