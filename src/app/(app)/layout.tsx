import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ScreenLoading } from "@/components/ui";

// 認証必須エリア。画面内容はブラウザでの認証状態に依存するため、
// instantナビゲーション検証の対象外とする(ブロッキングを許可)。
export const instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
