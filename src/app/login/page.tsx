import { Suspense } from "react";
import { LoginScreen } from "./login-screen";
import { ScreenLoading } from "@/components/ui";

export default function LoginPage() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <LoginScreen />
    </Suspense>
  );
}
