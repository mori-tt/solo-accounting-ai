import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  BIZ,
  EDITOR,
  aiSuggestion,
  closingCheck,
  expense,
  fiscalPeriod,
  journalEntry,
  OTHER_BIZ,
  OUTSIDER,
  OWNER,
  receipt,
  seed,
  seedBusiness,
  tx,
  VIEWER,
  anon,
  asUser,
  createTestEnv,
} from "./helpers";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await createTestEnv();
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedBusiness(
    testEnv,
    BIZ,
    { [OWNER]: "owner", [EDITOR]: "editor", [VIEWER]: "viewer" },
    OWNER,
  );
  await seedBusiness(testEnv, OTHER_BIZ, { [OUTSIDER]: "owner" }, OUTSIDER);
});

const tPath = (biz: string, id: string) => `businesses/${biz}/transactions/${id}`;

describe("未認証ユーザー", () => {
  it("businessドキュメントを読めない", async () => {
    await assertFails(anon(testEnv).doc(`businesses/${BIZ}`).get());
  });

  it("business配下のデータを読み書きできない", async () => {
    await seed(testEnv, { [tPath(BIZ, "t1")]: tx() });
    await assertFails(anon(testEnv).doc(tPath(BIZ, "t1")).get());
    await assertFails(
      anon(testEnv).doc(tPath(BIZ, "t2")).set({ ...tx(), createdBy: "x" }),
    );
  });

  it("businessを作成できない", async () => {
    await assertFails(
      anon(testEnv)
        .doc("businesses/new-biz")
        .set({ name: "x", ownerUid: "x" }),
    );
  });

  it("usersドキュメントを読めない", async () => {
    await seed(testEnv, {
      "users/u1": { displayName: "u1", email: "u1@example.com" },
    });
    await assertFails(anon(testEnv).doc("users/u1").get());
  });
});

describe("別businessIdへのアクセス", () => {
  it("他businessのbusinessドキュメントを読めない", async () => {
    await assertFails(asUser(testEnv, OWNER).doc(`businesses/${OTHER_BIZ}`).get());
  });

  it("他businessのデータを読めない", async () => {
    await seed(testEnv, { [tPath(OTHER_BIZ, "t1")]: tx() });
    await assertFails(asUser(testEnv, OWNER).doc(tPath(OTHER_BIZ, "t1")).get());
    await assertFails(
      asUser(testEnv, EDITOR).collection(`businesses/${OTHER_BIZ}/transactions`).get(),
    );
  });

  it("他businessへ書き込めない", async () => {
    await assertFails(
      asUser(testEnv, OWNER)
        .doc(tPath(OTHER_BIZ, "t2"))
        .set({ ...tx(), createdBy: OWNER }),
    );
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(`businesses/${OTHER_BIZ}/members/x`)
        .set({ role: "owner" }),
    );
  });
});

describe("member権限", () => {
  it("viewerは読み取りのみ", async () => {
    await seed(testEnv, { [tPath(BIZ, "t1")]: tx("confirmed") });
    const viewer = asUser(testEnv, VIEWER);
    await assertSucceeds(viewer.doc(tPath(BIZ, "t1")).get());
    await assertSucceeds(viewer.collection(`businesses/${BIZ}/transactions`).get());
    await assertFails(viewer.doc(tPath(BIZ, "t2")).set({ ...tx(), createdBy: VIEWER }));
    await assertFails(viewer.doc(tPath(BIZ, "t1")).update({ amount: 2000 }));
    await assertFails(viewer.doc(tPath(BIZ, "t1")).delete());
  });

  it("editorはデータを作成・更新できる", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(tPath(BIZ, "t1")).set({ ...tx(), createdBy: EDITOR }),
    );
    await assertSucceeds(editor.doc(tPath(BIZ, "t1")).update({ amount: 2000 }));
  });

  it("editorはdraftのみ削除できる", async () => {
    await seed(testEnv, {
      [tPath(BIZ, "draft")]: tx("draft"),
      [tPath(BIZ, "confirmed")]: tx("confirmed"),
    });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(editor.doc(tPath(BIZ, "draft")).delete());
    await assertFails(editor.doc(tPath(BIZ, "confirmed")).delete());
  });

  it("editorはmemberを管理できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor.doc(`businesses/${BIZ}/members/new`).set({ role: "viewer" }),
    );
    await assertFails(
      editor.doc(`businesses/${BIZ}/members/${VIEWER}`).update({ role: "editor" }),
    );
    await assertFails(editor.doc(`businesses/${BIZ}/members/${VIEWER}`).delete());
    // 自分のロール昇格も不可
    await assertFails(
      editor.doc(`businesses/${BIZ}/members/${EDITOR}`).update({ role: "owner" }),
    );
  });

  it("editorは期間を締められない", async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/fiscalPeriods/p1`]: fiscalPeriod("open"),
    });
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(`businesses/${BIZ}/fiscalPeriods/p1`)
        .update({ status: "closed" }),
    );
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(`businesses/${BIZ}/fiscalPeriods/p2`)
        .set(fiscalPeriod("open")),
    );
  });
});

describe("owner権限", () => {
  it("memberの追加・変更・削除ができる", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertSucceeds(
      owner.doc(`businesses/${BIZ}/members/new`).set({ role: "viewer" }),
    );
    await assertSucceeds(
      owner.doc(`businesses/${BIZ}/members/${VIEWER}`).update({ role: "editor" }),
    );
    await assertSucceeds(owner.doc(`businesses/${BIZ}/members/new`).delete());
  });

  it("business設定を更新できるがownerUidは変えられない", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertSucceeds(
      owner.doc(`businesses/${BIZ}`).update({ fiscalYearStartMonth: 4 }),
    );
    await assertFails(owner.doc(`businesses/${BIZ}`).update({ ownerUid: EDITOR }));
  });

  it("confirmedなTransactionを削除できる", async () => {
    await seed(testEnv, { [tPath(BIZ, "t1")]: tx("confirmed") });
    await assertSucceeds(asUser(testEnv, OWNER).doc(tPath(BIZ, "t1")).delete());
  });

  it("期間を作成し締めることができる", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertSucceeds(
      owner.doc(`businesses/${BIZ}/fiscalPeriods/p1`).set(fiscalPeriod("open")),
    );
    await assertSucceeds(
      owner.doc(`businesses/${BIZ}/fiscalPeriods/p1`).update({ status: "closed" }),
    );
  });

  it("business作成時に自分をownerとして登録できる", async () => {
    const db = asUser(testEnv, OWNER);
    const batch = db.batch();
    batch.set(db.doc("businesses/new-biz"), { name: "新規事業", ownerUid: OWNER });
    batch.set(db.doc(`businesses/new-biz/members/${OWNER}`), { role: "owner" });
    await assertSucceeds(batch.commit());
  });

  it("他人のbusinessではmemberを勝手に作成できない", async () => {
    await assertFails(
      asUser(testEnv, OUTSIDER)
        .doc(`businesses/${BIZ}/members/${OUTSIDER}`)
        .set({ role: "owner" }),
    );
  });
});

describe("管理者権限(Admin SDK)", () => {
  it("aiSuggestionをサーバーサイドから書き込める", async () => {
    await seed(testEnv, { [tPath(BIZ, "t1")]: tx() });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await assertSucceeds(
        ctx.firestore().doc(tPath(BIZ, "t1")).set(
          { aiSuggestion: { account: "502", confidence: 0.9 } },
          { merge: true },
        ),
      );
    });
  });

  it("締め処理でstatusをlockedにできる", async () => {
    await seed(testEnv, { [tPath(BIZ, "t1")]: tx("confirmed") });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await assertSucceeds(
        ctx.firestore().doc(tPath(BIZ, "t1")).update({ status: "locked" }),
      );
    });
  });

  it("クライアントはaiSuggestionを書けない", async () => {
    await seed(testEnv, { [tPath(BIZ, "t1")]: tx() });
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor
        .doc(tPath(BIZ, "t2"))
        .set({ ...tx(), createdBy: EDITOR, aiSuggestion: { account: "502" } }),
    );
    await assertFails(
      editor
        .doc(tPath(BIZ, "t1"))
        .update({ aiSuggestion: { account: "502" } }),
    );
  });

  it("クライアントはstatusをlockedにできない", async () => {
    await seed(testEnv, { [tPath(BIZ, "t1")]: tx("confirmed") });
    await assertFails(
      asUser(testEnv, OWNER).doc(tPath(BIZ, "t1")).update({ status: "locked" }),
    );
  });
});

describe("締め済み期間の保護", () => {
  beforeEach(async () => {
    await seed(testEnv, {
      [tPath(BIZ, "locked")]: tx("locked"),
      [tPath(BIZ, "open")]: tx("confirmed"),
      [`businesses/${BIZ}/expenses/e-locked`]: expense("locked"),
      [`businesses/${BIZ}/expenses/e-open`]: expense("confirmed"),
      [`businesses/${BIZ}/journalEntries/j-locked`]: journalEntry("locked"),
      [`businesses/${BIZ}/receipts/r-locked`]: { ...receipt("linked"), transactionId: "locked" },
      [`businesses/${BIZ}/fiscalPeriods/closed`]: fiscalPeriod("closed"),
    });
  });

  it("lockedなTransactionはownerもeditorも更新・削除できない", async () => {
    await assertFails(
      asUser(testEnv, OWNER).doc(tPath(BIZ, "locked")).update({ amount: 1 }),
    );
    await assertFails(
      asUser(testEnv, EDITOR).doc(tPath(BIZ, "locked")).update({ amount: 1 }),
    );
    await assertFails(asUser(testEnv, OWNER).doc(tPath(BIZ, "locked")).delete());
  });

  it("lockedなExpenseは変更・削除できない", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner.doc(`businesses/${BIZ}/expenses/e-locked`).update({ taxAmount: 200 }),
    );
    await assertFails(owner.doc(`businesses/${BIZ}/expenses/e-locked`).delete());
    // 未締めのExpenseは変更できる
    await assertSucceeds(
      owner.doc(`businesses/${BIZ}/expenses/e-open`).update({ taxAmount: 200 }),
    );
  });

  it("lockedなjournalEntryは更新・削除できない", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner.doc(`businesses/${BIZ}/journalEntries/j-locked`).update({ description: "x" }),
    );
    await assertFails(owner.doc(`businesses/${BIZ}/journalEntries/j-locked`).delete());
  });

  it("lockedなTransactionに紐付くreceiptは変更できない", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner.doc(`businesses/${BIZ}/receipts/r-locked`).update({ status: "archived" }),
    );
    await assertFails(owner.doc(`businesses/${BIZ}/receipts/r-locked`).delete());
  });

  it("クライアントはlocked状態のドキュメントを作成できない", async () => {
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(`businesses/${BIZ}/expenses/e-new`)
        .set({ ...expense("confirmed"), status: "locked" }),
    );
    await assertFails(
      asUser(testEnv, OWNER)
        .doc(`businesses/${BIZ}/journalEntries/j-new`)
        .set({ ...journalEntry("draft"), status: "locked", createdBy: OWNER }),
    );
  });

  it("closedになった期間は再オープン・削除できない", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner.doc(`businesses/${BIZ}/fiscalPeriods/closed`).update({ status: "open" }),
    );
    await assertFails(owner.doc(`businesses/${BIZ}/fiscalPeriods/closed`).delete());
  });
});

describe("users", () => {
  it("本人のドキュメントのみ読み書きできる", async () => {
    await seed(testEnv, {
      "users/u1": { displayName: "u1", email: "u1@example.com" },
    });
    const u1 = asUser(testEnv, "u1");
    await assertSucceeds(u1.doc("users/u1").get());
    await assertSucceeds(u1.doc("users/u1").update({ displayName: "U1" }));
    await assertFails(asUser(testEnv, "u2").doc("users/u1").get());
    await assertFails(
      asUser(testEnv, "u2").doc("users/u1").update({ displayName: "x" }),
    );
    await assertFails(u1.doc("users/u1").delete());
  });
});

describe("auditLogs", () => {
  const log = {
    actorUid: OWNER,
    action: "create",
    targetPath: `businesses/${BIZ}/transactions/t1`,
  };

  it("memberは自分名義のログを追記できる", async () => {
    await assertSucceeds(
      asUser(testEnv, OWNER).collection(`businesses/${BIZ}/auditLogs`).add(log),
    );
  });

  it("他人名義のログは追記できない", async () => {
    await assertFails(
      asUser(testEnv, EDITOR)
        .collection(`businesses/${BIZ}/auditLogs`)
        .add({ ...log, actorUid: OWNER }),
    );
  });

  it("ログは改ざん・削除できない(append-only)", async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/auditLogs/l1`]: { ...log },
    });
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner.doc(`businesses/${BIZ}/auditLogs/l1`).update({ action: "delete" }),
    );
    await assertFails(owner.doc(`businesses/${BIZ}/auditLogs/l1`).delete());
  });

  it("memberはログを読める", async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/auditLogs/l1`]: { ...log },
    });
    await assertSucceeds(
      asUser(testEnv, VIEWER).doc(`businesses/${BIZ}/auditLogs/l1`).get(),
    );
  });
});

describe("monthlySummaries", () => {
  it("memberは読めるがクライアントからは書き込めない", async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/monthlySummaries/202610`]: {
        totalIncome: 0,
        totalExpense: 0,
      },
    });
    await assertSucceeds(
      asUser(testEnv, VIEWER)
        .doc(`businesses/${BIZ}/monthlySummaries/202610`)
        .get(),
    );
    await assertFails(
      asUser(testEnv, OWNER)
        .doc(`businesses/${BIZ}/monthlySummaries/202610`)
        .update({ totalExpense: 999 }),
    );
  });
});

describe("journalEntries", () => {
  const jPath = (biz: string, id: string) => `businesses/${biz}/journalEntries/${id}`;

  it("memberは読み取れる", async () => {
    await seed(testEnv, { [jPath(BIZ, "j1")]: journalEntry("confirmed") });
    await assertSucceeds(asUser(testEnv, VIEWER).doc(jPath(BIZ, "j1")).get());
    await assertFails(asUser(testEnv, OUTSIDER).doc(jPath(BIZ, "j1")).get());
  });

  it("editorは仕訳候補を作成・確定できる", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(jPath(BIZ, "j1")).set({ ...journalEntry("draft"), createdBy: EDITOR }),
    );
    await assertSucceeds(editor.doc(jPath(BIZ, "j1")).update({ status: "confirmed" }));
  });

  it("viewerは作成・更新できない", async () => {
    await seed(testEnv, { [jPath(BIZ, "j1")]: journalEntry("draft") });
    const viewer = asUser(testEnv, VIEWER);
    await assertFails(
      viewer.doc(jPath(BIZ, "j2")).set({ ...journalEntry("draft"), createdBy: VIEWER }),
    );
    await assertFails(viewer.doc(jPath(BIZ, "j1")).update({ status: "confirmed" }));
  });

  it("editorはdraftのみ削除できる", async () => {
    await seed(testEnv, {
      [jPath(BIZ, "draft")]: journalEntry("draft"),
      [jPath(BIZ, "confirmed")]: journalEntry("confirmed"),
    });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(editor.doc(jPath(BIZ, "draft")).delete());
    await assertFails(editor.doc(jPath(BIZ, "confirmed")).delete());
  });

  it("aiSuggestionIdは作成後に変更できない", async () => {
    await seed(testEnv, { [jPath(BIZ, "j1")]: { ...journalEntry("draft"), aiSuggestionId: "s1" } });
    await assertFails(
      asUser(testEnv, EDITOR).doc(jPath(BIZ, "j1")).update({ aiSuggestionId: "s2" }),
    );
  });
});

describe("aiSuggestions", () => {
  const sPath = (biz: string, id: string) => `businesses/${biz}/aiSuggestions/${id}`;

  it("memberは読み取れる", async () => {
    await seed(testEnv, { [sPath(BIZ, "s1")]: aiSuggestion() });
    await assertSucceeds(asUser(testEnv, VIEWER).doc(sPath(BIZ, "s1")).get());
    await assertFails(asUser(testEnv, OUTSIDER).doc(sPath(BIZ, "s1")).get());
  });

  it("クライアントは提案を生成・削除できない(Admin SDKのみ)", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner.doc(sPath(BIZ, "s1")).set({ ...aiSuggestion(), createdBy: OWNER }),
    );
    await seed(testEnv, { [sPath(BIZ, "s2")]: aiSuggestion() });
    await assertFails(owner.doc(sPath(BIZ, "s2")).delete());
  });

  it("editor/ownerは提案を承認・却下できる", async () => {
    await seed(testEnv, {
      [sPath(BIZ, "s1")]: aiSuggestion(),
      [sPath(BIZ, "s2")]: aiSuggestion(),
    });
    await assertSucceeds(
      asUser(testEnv, EDITOR)
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", resolvedBy: EDITOR }),
    );
    await assertSucceeds(
      asUser(testEnv, OWNER)
        .doc(sPath(BIZ, "s2"))
        .update({ status: "rejected", resolvedBy: OWNER }),
    );
  });

  it("resolvedByに他人を設定できない", async () => {
    await seed(testEnv, { [sPath(BIZ, "s1")]: aiSuggestion() });
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", resolvedBy: OWNER }),
    );
  });

  it("提案内容・対象・信頼度はクライアントから変更できない", async () => {
    await seed(testEnv, { [sPath(BIZ, "s1")]: aiSuggestion() });
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", resolvedBy: OWNER, suggestion: { amount: 1 } }),
    );
    await assertFails(
      owner
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", resolvedBy: OWNER, confidence: 0.1 }),
    );
    await assertFails(
      owner
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", resolvedBy: OWNER, targetPath: "x" }),
    );
  });

  it("viewerは承認・却下できない", async () => {
    await seed(testEnv, { [sPath(BIZ, "s1")]: aiSuggestion() });
    await assertFails(
      asUser(testEnv, VIEWER)
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", resolvedBy: VIEWER }),
    );
  });
});

describe("closingChecks", () => {
  const cPath = (biz: string, id: string) => `businesses/${biz}/closingChecks/${id}`;

  it("memberは読み取れる", async () => {
    await seed(testEnv, { [cPath(BIZ, "c1")]: closingCheck() });
    await assertSucceeds(asUser(testEnv, VIEWER).doc(cPath(BIZ, "c1")).get());
    await assertFails(asUser(testEnv, OUTSIDER).doc(cPath(BIZ, "c1")).get());
  });

  it("editorはopenのカスタム項目を作成できる", async () => {
    await assertSucceeds(
      asUser(testEnv, EDITOR)
        .doc(cPath(BIZ, "c1"))
        .set({ ...closingCheck(), createdBy: EDITOR }),
    );
    // resolved状態での作成は不可
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(cPath(BIZ, "c2"))
        .set({ ...closingCheck("resolved"), createdBy: EDITOR }),
    );
  });

  it("editorは項目を解決・免除できる", async () => {
    await seed(testEnv, { [cPath(BIZ, "c1")]: closingCheck() });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(cPath(BIZ, "c1")).update({ status: "resolved", resolvedBy: EDITOR }),
    );
  });

  it("対象期間・種別・対象パスは変更できない", async () => {
    await seed(testEnv, { [cPath(BIZ, "c1")]: closingCheck() });
    const owner = asUser(testEnv, OWNER);
    await assertFails(owner.doc(cPath(BIZ, "c1")).update({ fiscalPeriodId: "p2" }));
    await assertFails(owner.doc(cPath(BIZ, "c1")).update({ type: "custom" }));
    await assertFails(owner.doc(cPath(BIZ, "c1")).update({ targetPath: "x" }));
  });

  it("viewerは作成・更新できない", async () => {
    await seed(testEnv, { [cPath(BIZ, "c1")]: closingCheck() });
    const viewer = asUser(testEnv, VIEWER);
    await assertFails(
      viewer.doc(cPath(BIZ, "c2")).set({ ...closingCheck(), createdBy: VIEWER }),
    );
    await assertFails(viewer.doc(cPath(BIZ, "c1")).update({ status: "resolved" }));
  });

  it("editorはopenのみ削除できる、ownerは全て削除できる", async () => {
    await seed(testEnv, {
      [cPath(BIZ, "open")]: closingCheck("open"),
      [cPath(BIZ, "resolved")]: closingCheck("resolved"),
    });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(editor.doc(cPath(BIZ, "open")).delete());
    await assertFails(editor.doc(cPath(BIZ, "resolved")).delete());
    await assertSucceeds(asUser(testEnv, OWNER).doc(cPath(BIZ, "resolved")).delete());
  });
});

describe("デフォルト拒否", () => {
  it("未定義のコレクション・パスへは書き込めない", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertFails(owner.doc("anything/x").set({ a: 1 }));
    await assertFails(owner.doc(`businesses/${BIZ}/unknownCol/x`).set({ a: 1 }));
  });
});
