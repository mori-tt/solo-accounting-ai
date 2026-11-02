import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { EmailVerifyBanner } from "@/components/email-verify-banner";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { LegalFooter } from "@/components/legal-footer";
import { LiveAnnouncer, ScreenLoading } from "@/components/ui";

// 認証必須エリア。画面内容はブラウザでの認証状態に依存するため、
// instantナビゲーション検証の対象外とする(ブロッキングを許可)。
export const instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* スクリーンリーダー通知用の常設ライブ領域。Suspenseのフォールバック
          表示中もアンマウントされないよう境界の外に置く */}
      <LiveAnnouncer />
      <Suspense fallback={<ScreenLoading />}>
        <EmailVerifyBanner />
        <KeyboardShortcuts />
        <AppShell>{children}</AppShell>
        <LegalFooter />
      </Suspense>
    </>
  );
}
