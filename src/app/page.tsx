import { redirect } from "next/navigation";

// "/" はアプリの入口。未認証なら AppShell が /login へ誘導する。
export const instant = false;

export default function Home() {
  redirect("/dashboard");
}
