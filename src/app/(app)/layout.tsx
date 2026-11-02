import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { EmailVerifyBanner } from "@/components/email-verify-banner";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { LegalFooter } from "@/components/legal-footer";
import { ScreenLoading } from "@/components/ui";

// 認証必須エリア。画面内容はブラウザでの認証状態に依存するため、
// instantナビゲーション検証の対象外とする(ブロッキングを許可)。
export const instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <EmailVerifyBanner />
      <KeyboardShortcuts />
      <AppShell>{children}</AppShell>
      <LegalFooter />
    </Suspense>
  );
}
