import type { ReactNode } from "react";
import { LegalFooter } from "@/components/legal-footer";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {children}
      </main>
      <LegalFooter />
    </>
  );
}
