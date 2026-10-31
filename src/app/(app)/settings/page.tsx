import { Suspense } from "react";
import { SettingsScreen } from "./settings-screen";
import { ScreenLoading } from "@/components/ui";

// 認証必須画面。ブラウザでの認証状態に依存するためinstant検証は対象外。
export const instant = false;

export default function SettingsPage() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <SettingsScreen />
    </Suspense>
  );
}
