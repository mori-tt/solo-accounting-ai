import { Suspense } from "react";
import { BackupScreen } from "./backup-screen";
import { ScreenLoading } from "@/components/ui";

// 認証必須画面。ブラウザでの認証状態に依存するためinstant検証は対象外。
export const instant = false;

export default function BackupPage() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <BackupScreen />
    </Suspense>
  );
}
