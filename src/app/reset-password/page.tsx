import { Suspense } from "react";
import { ResetPasswordScreen } from "./reset-password-screen";
import { ScreenLoading } from "@/components/ui";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <ResetPasswordScreen />
    </Suspense>
  );
}
