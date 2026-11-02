import { describe, expect, it } from "vitest";
import { formatYen } from "@/lib/format";
import { buildInvoiceMail } from "./invoice-mail";

const invoice = {
  id: "inv-abc",
  invoiceNumber: "INV-00012",
  issueDate: "2026-10-01",
  dueDate: "2026-10-31",
  totalAmount: 220000,
};

describe("buildInvoiceMail", () => {
  it("件名・本文に請求書番号・金額・支払期日を含む", () => {
    const mail = buildInvoiceMail({ invoice });
    expect(mail.subject).toContain("INV-00012");
    expect(mail.body).toContain("請求書番号: INV-00012");
    expect(mail.body).toContain("お支払期日: 2026年10月31日");
    expect(mail.body).toContain(`ご請求金額: ${formatYen(220000)}(税込)`);
    expect(mail.body).toContain("発行日: 2026年10月1日");
  });

  it("顧客のメールアドレスを宛先にし、顧客名を宛名に使う", () => {
    const mail = buildInvoiceMail({
      invoice,
      customerName: "株式会社テスト",
      customerEmail: "billing@test.example",
    });
    expect(mail.to).toBe("billing@test.example");
    expect(mail.body.startsWith("株式会社テスト 御中")).toBe(true);
  });

  it("顧客メールアドレスが無ければ宛先は未指定", () => {
    const mail = buildInvoiceMail({ invoice, customerName: "顧客A" });
    expect(mail.to).toBeUndefined();
    expect(mail.body.startsWith("顧客A 御中")).toBe(true);
  });

  it("請求書番号が無い旧データはIDを番号代わりに使う", () => {
    const mail = buildInvoiceMail({
      invoice: { ...invoice, invoiceNumber: undefined },
    });
    expect(mail.subject).toContain("inv-abc");
    expect(mail.body).toContain("請求書番号: inv-abc");
  });

  it("発行者名を署名として末尾付近に含める", () => {
    const mail = buildInvoiceMail({ invoice, issuerName: "山田太郎商店" });
    expect(mail.body).toContain("山田太郎商店");
  });

  it("送信前に請求書添付を促す注意書きを含める(mailtoでは添付不可)", () => {
    const mail = buildInvoiceMail({ invoice });
    expect(mail.body).toContain("請求書ファイルの添付");
  });
});
