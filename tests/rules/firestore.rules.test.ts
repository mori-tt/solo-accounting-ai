import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { serverTimestamp } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  BIZ,
  EDITOR,
  aiSuggestion,
  bill,
  billPayment,
  closingCheck,
  expense,
  fiscalPeriod,
  fixedAsset,
  inventoryCount,
  inventoryItem,
  journalEntry,
  OTHER_BIZ,
  OUTSIDER,
  OWNER,
  quote,
  receipt,
  recurringTemplate,
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
      editor
        .doc(`businesses/${BIZ}/members/new`)
        .set({ role: "viewer", uid: "new", invitedBy: EDITOR }),
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
      owner
        .doc(`businesses/${BIZ}/members/new`)
        .set({ role: "viewer", uid: "new", invitedBy: OWNER }),
    );
    await assertSucceeds(
      owner.doc(`businesses/${BIZ}/members/${VIEWER}`).update({ role: "editor" }),
    );
    await assertSucceeds(owner.doc(`businesses/${BIZ}/members/new`).delete());
  });

  it("uidとdoc IDが一致しないmember・他人名義のinvitedByは作成できない", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner
        .doc(`businesses/${BIZ}/members/x`)
        .set({ role: "viewer", uid: "other", invitedBy: OWNER }),
    );
    await assertFails(
      owner
        .doc(`businesses/${BIZ}/members/x`)
        .set({ role: "viewer", uid: "x", invitedBy: EDITOR }),
    );
    // uidフィールド自体をdoc IDとずらす更新も不可
    await seed(testEnv, {
      [`businesses/${BIZ}/members/m1`]: { uid: "m1", role: "viewer", invitedBy: OWNER },
    });
    await assertFails(
      owner.doc(`businesses/${BIZ}/members/m1`).update({ uid: "other" }),
    );
  });

  it("business.ownerUidのmemberは降格・削除できない(R2-4)", async () => {
    // 第2オーナー経由でも真のオーナーのmemberは保護される
    const OWNER2 = "owner2-uid";
    await seed(testEnv, {
      [`businesses/${BIZ}/members/${OWNER2}`]: {
        uid: OWNER2,
        role: "owner",
        invitedBy: OWNER,
      },
    });
    const second = asUser(testEnv, OWNER2);
    await assertFails(
      second.doc(`businesses/${BIZ}/members/${OWNER}`).update({ role: "viewer" }),
    );
    await assertFails(
      second.doc(`businesses/${BIZ}/members/${OWNER}`).delete(),
    );
    // owner自身による降格も不可
    await assertFails(
      asUser(testEnv, OWNER)
        .doc(`businesses/${BIZ}/members/${OWNER}`)
        .update({ role: "viewer" }),
    );
    // ownerUid以外のmemberの降格は可能
    await assertSucceeds(
      second.doc(`businesses/${BIZ}/members/${EDITOR}`).update({ role: "viewer" }),
    );
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
      owner
        .doc(`businesses/${BIZ}/fiscalPeriods/p1`)
        .update({ status: "closed", closedBy: OWNER }),
    );
  });

  it("締め処理のclosedByは実行者自身のみ、open維持の更新で帰属は変えられない", async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/fiscalPeriods/p1`]: fiscalPeriod("open"),
    });
    const owner = asUser(testEnv, OWNER);
    // 他人名義のclosedByは偽装になるため拒否
    await assertFails(
      owner
        .doc(`businesses/${BIZ}/fiscalPeriods/p1`)
        .update({ status: "closed", closedBy: EDITOR }),
    );
    // open維持の更新でclosedByを書き込めない(帰属の捏造)
    await assertFails(
      owner
        .doc(`businesses/${BIZ}/fiscalPeriods/p1`)
        .update({ closedBy: OWNER }),
    );
    // fiscalYear・期間は不変
    await assertFails(
      owner.doc(`businesses/${BIZ}/fiscalPeriods/p1`).update({ startDate: "2025-01-01" }),
    );
  });

  it("business作成時に自分をownerとして登録できる", async () => {
    const db = asUser(testEnv, OWNER);
    const batch = db.batch();
    batch.set(db.doc("businesses/new-biz"), { name: "新規事業", ownerUid: OWNER });
    batch.set(db.doc(`businesses/new-biz/members/${OWNER}`), {
      role: "owner",
      uid: OWNER,
      invitedBy: OWNER,
    });
    await assertSucceeds(batch.commit());
  });

  it("他人のbusinessではmemberを勝手に作成できない", async () => {
    await assertFails(
      asUser(testEnv, OUTSIDER)
        .doc(`businesses/${BIZ}/members/${OUTSIDER}`)
        .set({ role: "owner", uid: OUTSIDER, invitedBy: OUTSIDER }),
    );
  });
});

describe("基点owner(ownerUid)のmemberドキュメント保護", () => {
  it("owner本人でもownerUidのmemberドキュメントは変更・削除できない", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner.doc(`businesses/${BIZ}/members/${OWNER}`).update({ role: "viewer" }),
    );
    await assertFails(
      owner.doc(`businesses/${BIZ}/members/${OWNER}`).delete(),
    );
  });

  it("別のownerメンバーもownerUidのmemberドキュメントを降格・削除できない", async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/members/owner2`]: { role: "owner", invitedBy: OWNER },
    });
    const owner2 = asUser(testEnv, "owner2");
    await assertFails(
      owner2
        .doc(`businesses/${BIZ}/members/${OWNER}`)
        .update({ role: "viewer" }),
    );
    await assertFails(
      owner2.doc(`businesses/${BIZ}/members/${OWNER}`).delete(),
    );
  });

  it("ownerUid以外のmemberドキュメントは従来どおり変更・削除できる", async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/members/owner2`]: { role: "owner", invitedBy: OWNER },
    });
    const owner = asUser(testEnv, OWNER);
    await assertSucceeds(
      owner.doc(`businesses/${BIZ}/members/owner2`).update({ role: "viewer" }),
    );
    await assertSucceeds(
      owner.doc(`businesses/${BIZ}/members/owner2`).delete(),
    );
  });
});

describe("管理者権限(Admin SDK)", () => {
  it("aiSuggestionsドキュメントをサーバーサイドから作成できる", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await assertSucceeds(
        ctx
          .firestore()
          .doc(`businesses/${BIZ}/aiSuggestions/s1`)
          .set(aiSuggestion()),
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
      [`businesses/${BIZ}/receipts/r-locked`]: { ...receipt("linked", "r-locked"), transactionId: "locked" },
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

describe("締め済み期間の保護(請求書・入金)", () => {
  const invPath = (id: string) => `businesses/${BIZ}/invoices/${id}`;
  const payPath = (id: string) => `businesses/${BIZ}/payments/${id}`;
  // seedBusiness の fiscalYearStartMonth=1 のため 2025年の日付は fy2025 に属する
  const closedPeriod2025 = {
    ...fiscalPeriod("closed"),
    startDate: "2025-01-01",
    endDate: "2025-12-31",
  };
  const invoice = (issueDate: string, status = "issued") => ({
    customerId: "c1",
    issueDate,
    dueDate: "2025-12-31",
    totalAmount: 10000,
    status,
  });
  const payment = (date: string) => ({
    invoiceId: "i-open",
    date,
    amount: 1000,
  });

  beforeEach(async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/fiscalPeriods/fy2025`]: closedPeriod2025,
      [invPath("i-closed")]: invoice("2025-06-15"),
      [invPath("i-open")]: invoice("2026-06-15"),
      [invPath("i-open-draft")]: invoice("2026-06-15", "draft"),
      [payPath("p-closed")]: payment("2025-06-15"),
      [payPath("p-open")]: payment("2026-06-15"),
    });
  });

  it("締め済み期間のissueDateを持つ請求書は作成・更新・削除できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      editor.doc(invPath("i-new")).set(invoice("2025-06-15", "draft")),
    );
    await assertFails(
      editor.doc(invPath("i-closed")).update({ totalAmount: 1 }),
    );
    await assertFails(owner.doc(invPath("i-closed")).delete());
  });

  it("請求書のissueDateを締め済み期間へ・から移す変更も拒否する", async () => {
    const editor = asUser(testEnv, EDITOR);
    // 未締め→締め済みへの遡及変更
    await assertFails(
      editor.doc(invPath("i-open")).update({ issueDate: "2025-06-15" }),
    );
    // 締め済み→未締めへの変更(締め済み期間データの改変に相当)
    await assertFails(
      editor.doc(invPath("i-closed")).update({ issueDate: "2026-06-15" }),
    );
  });

  it("締め済み期間のdateを持つ入金は作成・更新・削除できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor.doc(payPath("p-new")).set(payment("2025-06-15")),
    );
    await assertFails(
      editor.doc(payPath("p-closed")).update({ amount: 1 }),
    );
    await assertFails(editor.doc(payPath("p-closed")).delete());
  });

  it("未締め期間の請求書・入金は仕様どおり操作できる", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(invPath("i-new")).set(invoice("2026-06-15", "draft")),
    );
    // 発行済み請求書の内容変更は不可(R2)。draftなら変更できる
    await assertFails(
      editor.doc(invPath("i-open")).update({ totalAmount: 1 }),
    );
    await assertSucceeds(
      editor.doc(invPath("i-open-draft")).update({ totalAmount: 1 }),
    );
    await assertSucceeds(
      editor.doc(payPath("p-new")).set(payment("2026-06-15")),
    );
    // editorが削除できるのはdraftのみ(既存仕様)
    await assertSucceeds(editor.doc(invPath("i-open-draft")).delete());
    await assertSucceeds(
      asUser(testEnv, OWNER).doc(invPath("i-open")).delete(),
    );
    // 消込後の金額・日付は不変(R2)。削除はownerのみ
    await assertFails(editor.doc(payPath("p-open")).update({ amount: 1 }));
    await assertFails(editor.doc(payPath("p-open")).delete());
    await assertSucceeds(
      asUser(testEnv, OWNER).doc(payPath("p-open")).delete(),
    );
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
    createdAt: serverTimestamp(),
  };

  it("editor/ownerは自分名義のログを追記できる", async () => {
    await assertSucceeds(
      asUser(testEnv, OWNER).collection(`businesses/${BIZ}/auditLogs`).add(log),
    );
    await assertSucceeds(
      asUser(testEnv, EDITOR)
        .collection(`businesses/${BIZ}/auditLogs`)
        .add({ ...log, actorUid: EDITOR }),
    );
  });

  it("viewerはログを追記できない(読み取り専用)", async () => {
    await assertFails(
      asUser(testEnv, VIEWER)
        .collection(`businesses/${BIZ}/auditLogs`)
        .add({ ...log, actorUid: VIEWER }),
    );
  });

  it("他人名義・他事業パス・定義外action・日付偽装のログは追記できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor
        .collection(`businesses/${BIZ}/auditLogs`)
        .add({ ...log, actorUid: OWNER }),
    );
    // targetPathは自事業配下のみ
    await assertFails(
      editor
        .collection(`businesses/${BIZ}/auditLogs`)
        .add({ ...log, actorUid: EDITOR, targetPath: "users/x" }),
    );
    // actionは定義済みのenumのみ
    await assertFails(
      editor
        .collection(`businesses/${BIZ}/auditLogs`)
        .add({ ...log, actorUid: EDITOR, action: "admin_bypass" }),
    );
    // createdAtはサーバー時刻のみ(過去日付への偽装を防ぐ)
    await assertFails(
      editor
        .collection(`businesses/${BIZ}/auditLogs`)
        .add({ ...log, actorUid: EDITOR, createdAt: new Date(0) }),
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

  it("削除はownerのみ(lockedはownerも不可)", async () => {
    await seed(testEnv, {
      [jPath(BIZ, "draft")]: journalEntry("draft"),
      [jPath(BIZ, "confirmed")]: journalEntry("confirmed"),
      [jPath(BIZ, "locked")]: journalEntry("locked"),
    });
    const editor = asUser(testEnv, EDITOR);
    const owner = asUser(testEnv, OWNER);
    // editorの削除は仕様外
    await assertFails(editor.doc(jPath(BIZ, "draft")).delete());
    await assertSucceeds(owner.doc(jPath(BIZ, "draft")).delete());
    await assertSucceeds(owner.doc(jPath(BIZ, "confirmed")).delete());
    await assertFails(owner.doc(jPath(BIZ, "locked")).delete());
  });

  it("confirmedな仕訳はクライアントから更新できない", async () => {
    await seed(testEnv, { [jPath(BIZ, "j1")]: journalEntry("confirmed") });
    await assertFails(
      asUser(testEnv, EDITOR).doc(jPath(BIZ, "j1")).update({ description: "x" }),
    );
    await assertFails(
      asUser(testEnv, EDITOR).doc(jPath(BIZ, "j1")).update({ status: "draft" }),
    );
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

  it("editor/ownerは未解決の提案を承認・却下できる", async () => {
    await seed(testEnv, {
      [sPath(BIZ, "s1")]: aiSuggestion(),
      [sPath(BIZ, "s2")]: aiSuggestion("needs_review"),
    });
    await assertSucceeds(
      asUser(testEnv, EDITOR)
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", decidedBy: EDITOR }),
    );
    await assertSucceeds(
      asUser(testEnv, OWNER)
        .doc(sPath(BIZ, "s2"))
        .update({ status: "rejected", decidedBy: OWNER }),
    );
  });

  it("解決済みの提案はクライアントから再解決できない", async () => {
    await seed(testEnv, { [sPath(BIZ, "s1")]: aiSuggestion("accepted") });
    await assertFails(
      asUser(testEnv, OWNER)
        .doc(sPath(BIZ, "s1"))
        .update({ status: "rejected", decidedBy: OWNER }),
    );
  });

  it("decidedByに他人を設定できない", async () => {
    await seed(testEnv, { [sPath(BIZ, "s1")]: aiSuggestion() });
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", decidedBy: OWNER }),
    );
  });

  it("提案内容・対象・信頼度はクライアントから変更できない", async () => {
    await seed(testEnv, { [sPath(BIZ, "s1")]: aiSuggestion() });
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", decidedBy: OWNER, payload: { amount: 1 } }),
    );
    await assertFails(
      owner
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", decidedBy: OWNER, confidence: 0.1 }),
    );
    await assertFails(
      owner
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", decidedBy: OWNER, kind: "duplicate_detection" }),
    );
    await assertFails(
      owner
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", decidedBy: OWNER, target: { type: "transaction", id: "t9" } }),
    );
  });

  it("viewerは承認・却下できない", async () => {
    await seed(testEnv, { [sPath(BIZ, "s1")]: aiSuggestion() });
    await assertFails(
      asUser(testEnv, VIEWER)
        .doc(sPath(BIZ, "s1"))
        .update({ status: "accepted", decidedBy: VIEWER }),
    );
  });
});

describe("closingChecks", () => {
  const cPath = (biz: string, id: string) => `businesses/${biz}/closingChecks/${id}`;

  // チェック項目は既存のopen期間へのみ作成できる
  beforeEach(async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/fiscalPeriods/p1`]: fiscalPeriod("open"),
    });
  });

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
    // 存在しない期間への項目作成は不可
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(cPath(BIZ, "c3"))
        .set({ ...closingCheck(), fiscalPeriodId: "missing", createdBy: EDITOR }),
    );
    // closed期間への項目作成は不可
    await seed(testEnv, {
      [`businesses/${BIZ}/fiscalPeriods/pc`]: fiscalPeriod("closed"),
    });
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(cPath(BIZ, "c4"))
        .set({ ...closingCheck(), fiscalPeriodId: "pc", createdBy: EDITOR }),
    );
  });

  it("editorは項目を解決・免除できる", async () => {
    await seed(testEnv, { [cPath(BIZ, "c1")]: closingCheck() });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(cPath(BIZ, "c1")).update({ status: "resolved", resolvedBy: EDITOR }),
    );
    // 他人名義の解決者は設定できない(帰属偽造)
    await seed(testEnv, { [cPath(BIZ, "c2")]: closingCheck() });
    await assertFails(
      editor.doc(cPath(BIZ, "c2")).update({ status: "resolved", resolvedBy: OWNER }),
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

  it("削除はownerのみ(締めた期間の項目はownerも削除できない)", async () => {
    await seed(testEnv, {
      [cPath(BIZ, "open")]: closingCheck("open"),
      [cPath(BIZ, "resolved")]: closingCheck("resolved"),
    });
    const editor = asUser(testEnv, EDITOR);
    // editorの削除は仕様外
    await assertFails(editor.doc(cPath(BIZ, "open")).delete());
    await assertSucceeds(asUser(testEnv, OWNER).doc(cPath(BIZ, "open")).delete());
    await assertSucceeds(asUser(testEnv, OWNER).doc(cPath(BIZ, "resolved")).delete());
    // 対象期間がclosedになった項目はownerも更新・削除できない
    await seed(testEnv, {
      [`businesses/${BIZ}/fiscalPeriods/p1`]: fiscalPeriod("closed"),
      [cPath(BIZ, "closed-check")]: closingCheck("open"),
    });
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      owner.doc(cPath(BIZ, "closed-check")).update({ status: "resolved", resolvedBy: OWNER }),
    );
    await assertFails(owner.doc(cPath(BIZ, "closed-check")).delete());
  });
});

describe("recurringTemplates", () => {
  const rPath = (biz: string, id: string) =>
    `businesses/${biz}/recurringTemplates/${id}`;

  it("memberは読み取れる", async () => {
    await seed(testEnv, { [rPath(BIZ, "r1")]: recurringTemplate() });
    await assertSucceeds(asUser(testEnv, VIEWER).doc(rPath(BIZ, "r1")).get());
    await assertSucceeds(
      asUser(testEnv, VIEWER)
        .collection(`businesses/${BIZ}/recurringTemplates`)
        .get(),
    );
    await assertFails(asUser(testEnv, OUTSIDER).doc(rPath(BIZ, "r1")).get());
  });

  it("editorは作成できる、viewerは作成できない", async () => {
    await assertSucceeds(
      asUser(testEnv, EDITOR)
        .doc(rPath(BIZ, "r1"))
        .set({ ...recurringTemplate(), createdBy: EDITOR }),
    );
    await assertFails(
      asUser(testEnv, VIEWER)
        .doc(rPath(BIZ, "r2"))
        .set({ ...recurringTemplate(), createdBy: VIEWER }),
    );
  });

  it("他人名義(createdBy不一致)では作成できない", async () => {
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(rPath(BIZ, "r1"))
        .set({ ...recurringTemplate(), createdBy: OWNER }),
    );
  });

  it("不正なデータでは作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor
        .doc(rPath(BIZ, "r1"))
        .set({ ...recurringTemplate(), createdBy: EDITOR, dayOfMonth: 0 }),
    );
    await assertFails(
      editor
        .doc(rPath(BIZ, "r2"))
        .set({ ...recurringTemplate(), createdBy: EDITOR, dayOfMonth: 32 }),
    );
    await assertFails(
      editor
        .doc(rPath(BIZ, "r3"))
        .set({ ...recurringTemplate(), createdBy: EDITOR, type: "other" }),
    );
    await assertFails(
      editor
        .doc(rPath(BIZ, "r4"))
        .set({ ...recurringTemplate(), createdBy: EDITOR, amount: "1000" }),
    );
    await assertFails(
      editor
        .doc(rPath(BIZ, "r5"))
        .set({ ...recurringTemplate(), createdBy: EDITOR, active: "yes" }),
    );
  });

  it("editorは更新・無効化できる", async () => {
    await seed(testEnv, { [rPath(BIZ, "r1")]: recurringTemplate() });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(rPath(BIZ, "r1")).update({ amount: 120000 }),
    );
    await assertSucceeds(
      editor.doc(rPath(BIZ, "r1")).update({ active: false }),
    );
    // 生成済み管理フィールドの更新(lastGeneratedMonth)
    await assertSucceeds(
      editor
        .doc(rPath(BIZ, "r1"))
        .update({ lastGeneratedMonth: "202610" }),
    );
  });

  it("createdBy/createdAtは更新で変更できない", async () => {
    await seed(testEnv, { [rPath(BIZ, "r1")]: recurringTemplate() });
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor.doc(rPath(BIZ, "r1")).update({ createdBy: EDITOR }),
    );
    await assertFails(
      editor.doc(rPath(BIZ, "r1")).update({ createdAt: "x" }),
    );
  });

  it("viewerは更新・削除できない", async () => {
    await seed(testEnv, { [rPath(BIZ, "r1")]: recurringTemplate() });
    const viewer = asUser(testEnv, VIEWER);
    await assertFails(viewer.doc(rPath(BIZ, "r1")).update({ active: false }));
    await assertFails(viewer.doc(rPath(BIZ, "r1")).delete());
  });

  it("削除はownerのみ", async () => {
    await seed(testEnv, { [rPath(BIZ, "r1")]: recurringTemplate() });
    await assertFails(asUser(testEnv, EDITOR).doc(rPath(BIZ, "r1")).delete());
    await assertSucceeds(asUser(testEnv, OWNER).doc(rPath(BIZ, "r1")).delete());
  });
});

describe("fixedAssets", () => {
  const fPath = (biz: string, id: string) =>
    `businesses/${biz}/fixedAssets/${id}`;

  it("memberは読み取れる", async () => {
    await seed(testEnv, { [fPath(BIZ, "a1")]: fixedAsset() });
    await assertSucceeds(asUser(testEnv, VIEWER).doc(fPath(BIZ, "a1")).get());
    await assertSucceeds(
      asUser(testEnv, VIEWER)
        .collection(`businesses/${BIZ}/fixedAssets`)
        .get(),
    );
    await assertFails(asUser(testEnv, OUTSIDER).doc(fPath(BIZ, "a1")).get());
  });

  it("editorは作成できる、viewerは作成できない", async () => {
    await assertSucceeds(
      asUser(testEnv, EDITOR)
        .doc(fPath(BIZ, "a1"))
        .set({ ...fixedAsset(), createdBy: EDITOR }),
    );
    await assertFails(
      asUser(testEnv, VIEWER)
        .doc(fPath(BIZ, "a2"))
        .set({ ...fixedAsset(), createdBy: VIEWER }),
    );
  });

  it("他人名義(createdBy不一致)では作成できない", async () => {
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(fPath(BIZ, "a1"))
        .set({ ...fixedAsset(), createdBy: OWNER }),
    );
  });

  it("不正なデータでは作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor
        .doc(fPath(BIZ, "a1"))
        .set({ ...fixedAsset(), createdBy: EDITOR, method: "other" }),
    );
    await assertFails(
      editor
        .doc(fPath(BIZ, "a2"))
        .set({ ...fixedAsset(), createdBy: EDITOR, usefulLifeYears: 0 }),
    );
    await assertFails(
      editor
        .doc(fPath(BIZ, "a3"))
        .set({ ...fixedAsset(), createdBy: EDITOR, businessRatio: 101 }),
    );
    await assertFails(
      editor
        .doc(fPath(BIZ, "a4"))
        .set({ ...fixedAsset(), createdBy: EDITOR, businessRatio: -1 }),
    );
    await assertFails(
      editor
        .doc(fPath(BIZ, "a5"))
        .set({ ...fixedAsset(), createdBy: EDITOR, acquisitionCost: "300000" }),
    );
    await assertFails(
      editor
        .doc(fPath(BIZ, "a6"))
        .set({ ...fixedAsset(), createdBy: EDITOR, acquiredDate: "2026-1-1" }),
    );
    await assertFails(
      editor
        .doc(fPath(BIZ, "a7"))
        .set({ ...fixedAsset(), createdBy: EDITOR, status: "gone" }),
    );
  });

  it("editorは更新・除却できる", async () => {
    await seed(testEnv, { [fPath(BIZ, "a1")]: fixedAsset() });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(fPath(BIZ, "a1")).update({ businessRatio: 50 }),
    );
    await assertSucceeds(
      editor
        .doc(fPath(BIZ, "a1"))
        .update({ status: "disposed", disposedDate: "2026-08-20" }),
    );
    // 計上済み管理フィールドの更新(lastBookedFiscalYear)
    await assertSucceeds(
      editor.doc(fPath(BIZ, "a1")).update({ lastBookedFiscalYear: 2026 }),
    );
  });

  it("createdBy/createdAtは更新で変更できない", async () => {
    await seed(testEnv, { [fPath(BIZ, "a1")]: fixedAsset() });
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor.doc(fPath(BIZ, "a1")).update({ createdBy: EDITOR }),
    );
    await assertFails(
      editor.doc(fPath(BIZ, "a1")).update({ createdAt: "x" }),
    );
  });

  it("viewerは更新・削除できない", async () => {
    await seed(testEnv, { [fPath(BIZ, "a1")]: fixedAsset() });
    const viewer = asUser(testEnv, VIEWER);
    await assertFails(
      viewer.doc(fPath(BIZ, "a1")).update({ status: "disposed" }),
    );
    await assertFails(viewer.doc(fPath(BIZ, "a1")).delete());
  });

  it("削除はownerのみ", async () => {
    await seed(testEnv, { [fPath(BIZ, "a1")]: fixedAsset() });
    await assertFails(asUser(testEnv, EDITOR).doc(fPath(BIZ, "a1")).delete());
    await assertSucceeds(asUser(testEnv, OWNER).doc(fPath(BIZ, "a1")).delete());
  });
});

describe("inventoryItems", () => {
  const iPath = (biz: string, id: string) =>
    `businesses/${biz}/inventoryItems/${id}`;

  it("memberは読み取れる", async () => {
    await seed(testEnv, { [iPath(BIZ, "i1")]: inventoryItem() });
    await assertSucceeds(asUser(testEnv, VIEWER).doc(iPath(BIZ, "i1")).get());
    await assertSucceeds(
      asUser(testEnv, VIEWER)
        .collection(`businesses/${BIZ}/inventoryItems`)
        .get(),
    );
    await assertFails(asUser(testEnv, OUTSIDER).doc(iPath(BIZ, "i1")).get());
  });

  it("editorは作成できる、viewerは作成できない", async () => {
    await assertSucceeds(
      asUser(testEnv, EDITOR)
        .doc(iPath(BIZ, "i1"))
        .set({ ...inventoryItem(), createdBy: EDITOR }),
    );
    await assertFails(
      asUser(testEnv, VIEWER)
        .doc(iPath(BIZ, "i2"))
        .set({ ...inventoryItem(), createdBy: VIEWER }),
    );
  });

  it("他人名義(createdBy不一致)では作成できない", async () => {
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(iPath(BIZ, "i1"))
        .set({ ...inventoryItem(), createdBy: OWNER }),
    );
  });

  it("不正なデータでは作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor
        .doc(iPath(BIZ, "i1"))
        .set({ ...inventoryItem(), createdBy: EDITOR, standardUnitPrice: -1 }),
    );
    await assertFails(
      editor
        .doc(iPath(BIZ, "i2"))
        .set({
          ...inventoryItem(),
          createdBy: EDITOR,
          standardUnitPrice: 1.5,
        }),
    );
    await assertFails(
      editor
        .doc(iPath(BIZ, "i3"))
        .set({ ...inventoryItem(), createdBy: EDITOR, unit: 5 }),
    );
  });

  it("editorは更新できるが createdBy/createdAt は変更できない", async () => {
    await seed(testEnv, { [iPath(BIZ, "i1")]: inventoryItem() });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(iPath(BIZ, "i1")).update({ standardUnitPrice: 2000 }),
    );
    await assertFails(
      editor.doc(iPath(BIZ, "i1")).update({ createdBy: EDITOR }),
    );
    await assertFails(
      editor.doc(iPath(BIZ, "i1")).update({ createdAt: "x" }),
    );
  });

  it("削除はownerのみ", async () => {
    await seed(testEnv, { [iPath(BIZ, "i1")]: inventoryItem() });
    await assertFails(asUser(testEnv, EDITOR).doc(iPath(BIZ, "i1")).delete());
    await assertSucceeds(asUser(testEnv, OWNER).doc(iPath(BIZ, "i1")).delete());
  });
});

describe("inventoryCounts", () => {
  const cPath = (biz: string, id: string) =>
    `businesses/${biz}/inventoryCounts/${id}`;

  it("memberは読み取れる", async () => {
    await seed(testEnv, { [cPath(BIZ, "fy2026")]: inventoryCount() });
    await assertSucceeds(
      asUser(testEnv, VIEWER).doc(cPath(BIZ, "fy2026")).get(),
    );
    await assertSucceeds(
      asUser(testEnv, VIEWER)
        .collection(`businesses/${BIZ}/inventoryCounts`)
        .get(),
    );
    await assertFails(
      asUser(testEnv, OUTSIDER).doc(cPath(BIZ, "fy2026")).get(),
    );
  });

  it("editorは作成できる、viewerは作成できない", async () => {
    await assertSucceeds(
      asUser(testEnv, EDITOR)
        .doc(cPath(BIZ, "fy2026"))
        .set({ ...inventoryCount(), createdBy: EDITOR }),
    );
    await assertFails(
      asUser(testEnv, VIEWER)
        .doc(cPath(BIZ, "fy2025"))
        .set({ ...inventoryCount(2025), createdBy: VIEWER }),
    );
  });

  it("他人名義(createdBy不一致)では作成できない", async () => {
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(cPath(BIZ, "fy2026"))
        .set({ ...inventoryCount(), createdBy: OWNER }),
    );
  });

  it("docIDとfiscalYearが一致しないと作成できない", async () => {
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(cPath(BIZ, "fy2027"))
        .set({ ...inventoryCount(2026), createdBy: EDITOR }),
    );
    await assertFails(
      asUser(testEnv, EDITOR)
        .doc(cPath(BIZ, "random"))
        .set({ ...inventoryCount(), createdBy: EDITOR }),
    );
  });

  it("不正なデータでは作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor
        .doc(cPath(BIZ, "fy2026"))
        .set({ ...inventoryCount(), createdBy: EDITOR, fiscalYear: "2026" }),
    );
    await assertFails(
      editor
        .doc(cPath(BIZ, "fy2026"))
        .set({ ...inventoryCount(), createdBy: EDITOR, lines: "x" }),
    );
  });

  it("editorは更新できるが fiscalYear/createdBy/createdAt は変更できない", async () => {
    await seed(testEnv, { [cPath(BIZ, "fy2026")]: inventoryCount() });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(cPath(BIZ, "fy2026")).update({ lines: [] }),
    );
    await assertFails(
      editor.doc(cPath(BIZ, "fy2026")).update({ fiscalYear: 2027 }),
    );
    await assertFails(
      editor.doc(cPath(BIZ, "fy2026")).update({ createdBy: EDITOR }),
    );
    await assertFails(
      editor.doc(cPath(BIZ, "fy2026")).update({ createdAt: "x" }),
    );
  });

  it("締め済み年度のカウントは作成・更新・削除できない", async () => {
    await seed(testEnv, {
      [cPath(BIZ, "fy2026")]: inventoryCount(),
      [`businesses/${BIZ}/fiscalPeriods/fy2026`]: fiscalPeriod("closed"),
    });
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor.doc(cPath(BIZ, "fy2026")).update({ lines: [] }),
    );
    await assertFails(
      editor
        .doc(cPath(BIZ, "fy2026"))
        .set({ ...inventoryCount(), createdBy: EDITOR }),
    );
    await assertFails(asUser(testEnv, OWNER).doc(cPath(BIZ, "fy2026")).delete());
    // 未締め年度は従来どおり操作できる
    await assertSucceeds(
      editor
        .doc(cPath(BIZ, "fy2027"))
        .set({ ...inventoryCount(2027), createdBy: EDITOR }),
    );
  });

  it("open期間の年度は操作できる", async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/fiscalPeriods/fy2026`]: fiscalPeriod("open"),
    });
    await assertSucceeds(
      asUser(testEnv, EDITOR)
        .doc(cPath(BIZ, "fy2026"))
        .set({ ...inventoryCount(), createdBy: EDITOR }),
    );
  });

  it("削除はownerのみ", async () => {
    await seed(testEnv, { [cPath(BIZ, "fy2026")]: inventoryCount() });
    await assertFails(
      asUser(testEnv, EDITOR).doc(cPath(BIZ, "fy2026")).delete(),
    );
    await assertSucceeds(
      asUser(testEnv, OWNER).doc(cPath(BIZ, "fy2026")).delete(),
    );
  });
});

describe("receipts の storagePath/mimeType(R2-1)", () => {
  const rPath = (biz: string, id: string) => `businesses/${biz}/receipts/${id}`;

  it("正当な登録値なら作成できる", async () => {
    await assertSucceeds(
      asUser(testEnv, EDITOR)
        .doc(rPath(BIZ, "r9"))
        .set({ ...receipt("unprocessed", "r9"), createdBy: EDITOR }),
    );
  });

  it("他事業・他証憑のstoragePathは作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor
        .doc(rPath(BIZ, "r9"))
        .set({
          ...receipt("unprocessed", "r9"),
          storagePath: `receipts/${OTHER_BIZ}/r9/file.png`,
          createdBy: EDITOR,
        }),
    );
    // 別receiptのファイルを指すパスも不可(差し替え・流出防止)
    await assertFails(
      editor
        .doc(rPath(BIZ, "r9"))
        .set({
          ...receipt("unprocessed", "r9"),
          storagePath: `receipts/${BIZ}/other-receipt/file.png`,
          createdBy: EDITOR,
        }),
    );
    // receipts/配下以外の任意パスも不可
    await assertFails(
      editor
        .doc(rPath(BIZ, "r9"))
        .set({
          ...receipt("unprocessed", "r9"),
          storagePath: "secrets/admin-key.json",
          createdBy: EDITOR,
        }),
    );
  });

  it("許可外のmimeTypeは作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor
        .doc(rPath(BIZ, "r9"))
        .set({ ...receipt("unprocessed", "r9"), mimeType: "text/html", createdBy: EDITOR }),
    );
    await assertFails(
      editor
        .doc(rPath(BIZ, "r9"))
        .set({ ...receipt("unprocessed", "r9"), mimeType: "application/javascript", createdBy: EDITOR }),
    );
  });

  it("storagePath/fileName/mimeTypeは登録後に変更できない", async () => {
    await seed(testEnv, { [rPath(BIZ, "r1")]: receipt("unprocessed", "r1") });
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor.doc(rPath(BIZ, "r1")).update({ storagePath: `receipts/${OTHER_BIZ}/x/f` }),
    );
    await assertFails(
      editor.doc(rPath(BIZ, "r1")).update({ mimeType: "text/html" }),
    );
    await assertFails(
      editor.doc(rPath(BIZ, "r1")).update({ fileName: "renamed.png" }),
    );
    // statusの変更は可能
    await assertSucceeds(
      editor.doc(rPath(BIZ, "r1")).update({ status: "archived" }),
    );
  });

  it("存在しない・締め済みのtransactionへのリンクは設定できない", async () => {
    await seed(testEnv, {
      [tPath(BIZ, "tx-draft")]: tx("draft"),
      [tPath(BIZ, "tx-locked")]: tx("locked"),
      [rPath(BIZ, "r1")]: receipt("unprocessed", "r1"),
    });
    const editor = asUser(testEnv, EDITOR);
    // 既存の未締めtxへのリンクは可能
    await assertSucceeds(
      editor.doc(rPath(BIZ, "r1")).update({ transactionId: "tx-draft" }),
    );
    // 存在しないtxは影の参照になるため不可
    await assertFails(
      editor.doc(rPath(BIZ, "r1")).update({ transactionId: "ghost" }),
    );
    // 締め済みtxへのリンクは不可
    await assertFails(
      editor.doc(rPath(BIZ, "r1")).update({ transactionId: "tx-locked" }),
    );
  });

  it("検索要件メタデータ(取引日/金額/取引先)を設定・更新できる", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(rPath(BIZ, "r9")).set({
        ...receipt("unprocessed", "r9"),
        createdBy: EDITOR,
        transactionDate: "2026-10-15",
        amount: 12000,
        counterparty: "テスト商店",
      }),
    );
    await seed(testEnv, { [rPath(BIZ, "r1")]: receipt("unprocessed", "r1") });
    await assertSucceeds(
      editor.doc(rPath(BIZ, "r1")).update({
        transactionDate: "2026-10-20",
        amount: 3000,
        counterparty: "別商店",
      }),
    );
  });

  it("不正な型のメタデータは設定できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    // 日付形式でない transactionDate は不可
    await assertFails(
      editor.doc(rPath(BIZ, "r9")).set({
        ...receipt("unprocessed", "r9"),
        createdBy: EDITOR,
        transactionDate: "2026/10/15",
      }),
    );
    // 数値以外の amount は不可
    await assertFails(
      editor.doc(rPath(BIZ, "r9")).set({
        ...receipt("unprocessed", "r9"),
        createdBy: EDITOR,
        amount: "12000",
      }),
    );
    // 文字列以外の counterparty は不可
    await assertFails(
      editor.doc(rPath(BIZ, "r9")).set({
        ...receipt("unprocessed", "r9"),
        createdBy: EDITOR,
        counterparty: 123,
      }),
    );
  });
});

describe("closed期間の日付保護(R2-3)", () => {
  // fiscalYearStartMonth=1 のため 2026年内の日付は fy2026 に属する
  const FP = `businesses/${BIZ}/fiscalPeriods/fy2026`;

  beforeEach(async () => {
    await seed(testEnv, {
      [FP]: {
        fiscalYear: 2026,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        status: "closed",
        closedBy: OWNER,
      },
    });
  });

  it("closed期間内の日付でtransactionを作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor.doc(tPath(BIZ, "t1")).set({ ...tx(), createdBy: EDITOR }),
    );
    // 期間外(期間doc未作成の年)なら作成できる
    await assertSucceeds(
      editor
        .doc(tPath(BIZ, "t2"))
        .set({ ...tx(), date: "2027-01-10", createdBy: EDITOR }),
    );
  });

  it("closed期間内のtransactionを更新・削除できない", async () => {
    await seed(testEnv, {
      [tPath(BIZ, "t1")]: tx("confirmed"),
      [tPath(BIZ, "t2")]: { ...tx("draft"), date: "2027-01-10" },
    });
    const editor = asUser(testEnv, EDITOR);
    const owner = asUser(testEnv, OWNER);
    await assertFails(editor.doc(tPath(BIZ, "t1")).update({ amount: 1 }));
    await assertFails(owner.doc(tPath(BIZ, "t1")).delete());
    // 期間外の日付をclosed期間へ書き換えることも不可
    await assertFails(
      editor.doc(tPath(BIZ, "t2")).update({ date: "2026-10-15" }),
    );
    await assertSucceeds(editor.doc(tPath(BIZ, "t2")).update({ amount: 5 }));
    await assertSucceeds(editor.doc(tPath(BIZ, "t2")).delete());
  });

  it("closed期間内の日付でjournalEntry・invoiceを作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor
        .doc(`businesses/${BIZ}/journalEntries/j1`)
        .set({ ...journalEntry("draft"), createdBy: EDITOR }),
    );
    await assertFails(
      editor.doc(`businesses/${BIZ}/invoices/i1`).set({
        customerId: "c1",
        issueDate: "2026-10-01",
        dueDate: "2026-10-31",
        items: [{ description: "x", quantity: 1, unitPrice: 100 }],
        totalAmount: 100,
        status: "draft",
      }),
    );
    await assertFails(
      editor.doc(`businesses/${BIZ}/payments/p1`).set({
        invoiceId: "i1",
        date: "2026-10-20",
        amount: 100,
      }),
    );
  });
});

describe("invoices / payments(R2-10, R2-11)", () => {
  const iPath = (id: string) => `businesses/${BIZ}/invoices/${id}`;
  const pPath = (id: string) => `businesses/${BIZ}/payments/${id}`;
  const invoice = (status = "draft") => ({
    customerId: "c1",
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    items: [{ description: "作業費", quantity: 1, unitPrice: 10000 }],
    totalAmount: 10000,
    status,
  });
  const payment = (extra: Record<string, unknown> = {}) => ({
    invoiceId: "inv-1",
    date: "2026-10-20",
    amount: 5000,
    ...extra,
  });

  it("発行済み請求書は内容・statusをクライアントから変更できない", async () => {
    await seed(testEnv, { [iPath("inv-1")]: invoice("issued") });
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor.doc(iPath("inv-1")).update({ items: [] }),
    );
    await assertFails(
      editor.doc(iPath("inv-1")).update({ status: "paid" }),
    );
    await assertFails(
      editor.doc(iPath("inv-1")).update({ status: "draft" }),
    );
    await assertFails(
      editor.doc(iPath("inv-1")).update({ customerId: "c2" }),
    );
  });

  it("draft請求書は更新でき、editorはdraftのみ削除できる", async () => {
    await seed(testEnv, {
      [iPath("inv-d")]: invoice("draft"),
      [iPath("inv-i")]: invoice("issued"),
    });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(iPath("inv-d")).update({ totalAmount: 9000 }),
    );
    await assertSucceeds(editor.doc(iPath("inv-d")).delete());
    await assertFails(editor.doc(iPath("inv-i")).delete());
    await assertSucceeds(asUser(testEnv, OWNER).doc(iPath("inv-i")).delete());
  });

  it("paymentは実在する請求書へのみ作成でき、確定項目は変更できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    // 存在しない請求書へのpaymentは影の消込になるため不可
    await assertFails(editor.doc(pPath("p1")).set(payment()));
    await seed(testEnv, { [iPath("inv-1")]: invoice("issued") });
    await assertSucceeds(editor.doc(pPath("p1")).set(payment()));
    // 金額・日付・消込先・対応transactionは不変
    await assertFails(editor.doc(pPath("p1")).update({ amount: 1 }));
    await assertFails(editor.doc(pPath("p1")).update({ date: "2026-10-21" }));
    await assertFails(editor.doc(pPath("p1")).update({ invoiceId: "inv-2" }));
    await assertFails(
      editor.doc(pPath("p1")).update({ transactionId: "t9" }),
    );
    // 削除はownerのみ
    await assertFails(editor.doc(pPath("p1")).delete());
    await assertSucceeds(asUser(testEnv, OWNER).doc(pPath("p1")).delete());
  });
});

describe("quotes(Issue #129)", () => {
  const qPath = (id: string) => `businesses/${BIZ}/quotes/${id}`;

  it("memberのみ読み取りでき、非メンバー・未認証は読めない", async () => {
    await seed(testEnv, { [qPath("q1")]: quote("sent") });
    await assertSucceeds(asUser(testEnv, VIEWER).doc(qPath("q1")).get());
    await assertFails(asUser(testEnv, OUTSIDER).doc(qPath("q1")).get());
    await assertFails(anon(testEnv).doc(qPath("q1")).get());
  });

  it("editorは作成でき、viewer・不正データは作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    const viewer = asUser(testEnv, VIEWER);
    await assertSucceeds(editor.doc(qPath("q1")).set(quote("draft")));
    await assertFails(viewer.doc(qPath("q2")).set(quote("draft")));
    // 不正なstatus・日付形式・金額は拒否
    await assertFails(
      editor.doc(qPath("q3")).set({ ...quote("draft"), status: "bogus" }),
    );
    await assertFails(
      editor.doc(qPath("q4")).set({ ...quote("draft"), validUntil: "10/31" }),
    );
    await assertFails(
      editor
        .doc(qPath("q5"))
        .set({ ...quote("draft"), totalAmount: "10000" }),
    );
  });

  it("sent以降の見積は内容・statusをクライアントから変更できない", async () => {
    await seed(testEnv, { [qPath("q1")]: quote("sent") });
    const editor = asUser(testEnv, EDITOR);
    await assertFails(editor.doc(qPath("q1")).update({ items: [] }));
    await assertFails(editor.doc(qPath("q1")).update({ status: "accepted" }));
    await assertFails(editor.doc(qPath("q1")).update({ status: "draft" }));
    await assertFails(editor.doc(qPath("q1")).update({ customerId: "c2" }));
    await assertFails(
      editor.doc(qPath("q1")).update({ convertedInvoiceId: "i1" }),
    );
  });

  it("draft見積は更新でき、editorはdraftのみ削除できる", async () => {
    await seed(testEnv, {
      [qPath("q-d")]: quote("draft"),
      [qPath("q-s")]: quote("sent"),
      [qPath("q-c")]: quote("converted"),
    });
    const editor = asUser(testEnv, EDITOR);
    const owner = asUser(testEnv, OWNER);
    await assertSucceeds(
      editor.doc(qPath("q-d")).update({ totalAmount: 9000 }),
    );
    await assertSucceeds(editor.doc(qPath("q-d")).delete());
    await assertFails(editor.doc(qPath("q-s")).delete());
    await assertFails(editor.doc(qPath("q-c")).delete());
    await assertSucceeds(owner.doc(qPath("q-s")).delete());
    await assertSucceeds(owner.doc(qPath("q-c")).delete());
  });

  it("closed期間のissueDateを持つ見積は作成・更新・削除できない", async () => {
    const closedPeriod2025 = {
      ...fiscalPeriod("closed"),
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    };
    await seed(testEnv, {
      [`businesses/${BIZ}/fiscalPeriods/fy2025`]: closedPeriod2025,
      [qPath("q-closed")]: { ...quote("sent"), issueDate: "2025-06-15" },
    });
    const editor = asUser(testEnv, EDITOR);
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      editor
        .doc(qPath("q-new"))
        .set({ ...quote("draft"), issueDate: "2025-06-15" }),
    );
    await assertFails(
      editor.doc(qPath("q-closed")).update({ validUntil: "2025-12-31" }),
    );
    await assertFails(owner.doc(qPath("q-closed")).delete());
  });
});

describe("bills / billPayments(買掛の支払消込)", () => {
  const bPath = (id: string) => `businesses/${BIZ}/bills/${id}`;
  const bpPath = (id: string) => `businesses/${BIZ}/billPayments/${id}`;

  it("editorは請求書を作成でき、viewerは作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    const viewer = asUser(testEnv, VIEWER);
    await assertSucceeds(
      editor.doc(bPath("b1")).set({ ...bill(), createdBy: EDITOR }),
    );
    await assertFails(
      viewer.doc(bPath("b2")).set({ ...bill(), createdBy: VIEWER }),
    );
  });

  it("createdByを偽装して作成できない・statusや日付の不正値は拒否", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor.doc(bPath("b1")).set({ ...bill(), createdBy: OWNER }),
    );
    await assertFails(
      editor
        .doc(bPath("b1"))
        .set({ ...bill(), status: "overdue", createdBy: EDITOR }),
    );
    await assertFails(
      editor
        .doc(bPath("b1"))
        .set({ ...bill(), dueDate: "2026/10/31", createdBy: EDITOR }),
    );
    await assertFails(
      editor
        .doc(bPath("b1"))
        .set({ ...bill(), totalAmount: "110000", createdBy: EDITOR }),
    );
  });

  it("未払の請求書は更新でき、支払済みは内容・statusを変更できない", async () => {
    await seed(testEnv, {
      [bPath("b-unpaid")]: bill("unpaid"),
      [bPath("b-paid")]: bill("paid"),
    });
    const editor = asUser(testEnv, EDITOR);
    await assertSucceeds(
      editor.doc(bPath("b-unpaid")).update({ totalAmount: 99000 }),
    );
    await assertFails(
      editor.doc(bPath("b-paid")).update({ totalAmount: 1 }),
    );
    await assertFails(
      editor.doc(bPath("b-paid")).update({ status: "unpaid" }),
    );
    await assertFails(
      editor.doc(bPath("b-paid")).update({ vendorName: "他社" }),
    );
    await assertFails(
      editor.doc(bPath("b-paid")).update({ dueDate: "2026-11-01" }),
    );
    // createdBy・createdAtは不変
    await assertFails(
      editor.doc(bPath("b-unpaid")).update({ createdBy: "x" }),
    );
  });

  it("editorは未払のみ削除でき、支払済みの削除はownerのみ", async () => {
    await seed(testEnv, {
      [bPath("b-unpaid")]: bill("unpaid"),
      [bPath("b-paid")]: bill("paid"),
    });
    const editor = asUser(testEnv, EDITOR);
    const owner = asUser(testEnv, OWNER);
    await assertSucceeds(editor.doc(bPath("b-unpaid")).delete());
    await assertFails(editor.doc(bPath("b-paid")).delete());
    await assertSucceeds(owner.doc(bPath("b-paid")).delete());
  });

  it("closed期間内の受領日では作成・削除・変更できない", async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/fiscalPeriods/fy2026`]: {
        fiscalYear: 2026,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        status: "closed",
        closedBy: OWNER,
      },
      [bPath("b1")]: bill("unpaid"),
      [bPath("b2")]: bill("unpaid", { receivedDate: "2027-01-10" }),
    });
    const editor = asUser(testEnv, EDITOR);
    const owner = asUser(testEnv, OWNER);
    await assertFails(
      editor.doc(bPath("b3")).set({ ...bill(), createdBy: EDITOR }),
    );
    await assertFails(editor.doc(bPath("b1")).update({ totalAmount: 1 }));
    await assertFails(owner.doc(bPath("b1")).delete());
    // 期間外の受領日をclosed期間へ書き換えることも不可
    await assertFails(
      editor.doc(bPath("b2")).update({ receivedDate: "2026-10-01" }),
    );
  });

  it("billPaymentは実在する請求書へのみ作成でき、確定項目は変更できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    // 存在しない請求書への支払は影の消込になるため不可
    await assertFails(editor.doc(bpPath("p1")).set(billPayment()));
    await seed(testEnv, { [bPath("bill-1")]: bill("unpaid") });
    await assertSucceeds(editor.doc(bpPath("p1")).set(billPayment()));
    // 金額・日付・消込先・対応transactionは不変
    await assertFails(editor.doc(bpPath("p1")).update({ amount: 1 }));
    await assertFails(editor.doc(bpPath("p1")).update({ date: "2026-10-21" }));
    await assertFails(editor.doc(bpPath("p1")).update({ billId: "bill-2" }));
    await assertFails(
      editor.doc(bpPath("p1")).update({ transactionId: "t9" }),
    );
    // 削除はownerのみ
    await assertFails(editor.doc(bpPath("p1")).delete());
    await assertSucceeds(asUser(testEnv, OWNER).doc(bpPath("p1")).delete());
  });

  it("billPaymentのtransactionIdは支出取引のみ紐付けられる", async () => {
    await seed(testEnv, {
      [bPath("bill-1")]: bill("unpaid"),
      [tPath(BIZ, "tx-exp")]: tx("confirmed"),
      [tPath(BIZ, "tx-income")]: { ...tx("confirmed"), type: "income" },
    });
    const editor = asUser(testEnv, EDITOR);
    // 収入取引への紐付けは拒否
    await assertFails(
      editor
        .doc(bpPath("p1"))
        .set(billPayment({ transactionId: "tx-income" })),
    );
    // 存在しない取引への紐付けも拒否
    await assertFails(
      editor
        .doc(bpPath("p1"))
        .set(billPayment({ transactionId: "ghost" })),
    );
    await assertSucceeds(
      editor
        .doc(bpPath("p1"))
        .set(billPayment({ transactionId: "tx-exp" })),
    );
  });
});

describe("expenses(R2-12, R2-21)", () => {
  const ePath = (id: string) => `businesses/${BIZ}/expenses/${id}`;

  it("削除はownerのみ(locked・締め済みtx紐付きはownerも不可)", async () => {
    await seed(testEnv, {
      [ePath("e1")]: expense("draft"),
      [ePath("e2")]: { ...expense("confirmed"), transactionId: "tx-locked" },
      [tPath(BIZ, "tx-locked")]: tx("locked"),
    });
    const editor = asUser(testEnv, EDITOR);
    const owner = asUser(testEnv, OWNER);
    await assertFails(editor.doc(ePath("e1")).delete());
    await assertSucceeds(owner.doc(ePath("e1")).delete());
    // 締め済みtx紐付きのexpenseは削除・更新できない
    await assertFails(owner.doc(ePath("e2")).delete());
    await assertFails(owner.doc(ePath("e2")).update({ taxAmount: 1 }));
  });

  it("statusフィールドを持たないドキュメントはクライアントから更新できない(fail-closed)", async () => {
    // ドメインはstatusを持たないexpenseを書く(スキーマ形状)
    await seed(testEnv, {
      [ePath("e1")]: { taxCategory: "課税仕入", taxAmount: 100, createdBy: "seed" },
    });
    await assertFails(
      asUser(testEnv, EDITOR).doc(ePath("e1")).update({ taxAmount: 200 }),
    );
    await assertFails(asUser(testEnv, OWNER).doc(ePath("e1")).delete());
  });

  it("存在しないtransaction/receiptへの参照では作成できない", async () => {
    const editor = asUser(testEnv, EDITOR);
    await assertFails(
      editor
        .doc(ePath("e1"))
        .set({ ...expense("draft"), transactionId: "ghost", createdBy: EDITOR }),
    );
    await assertFails(
      editor
        .doc(ePath("e1"))
        .set({ ...expense("draft"), receiptId: "ghost", createdBy: EDITOR }),
    );
    await seed(testEnv, {
      [tPath(BIZ, "tx-draft")]: tx("draft"),
      [`businesses/${BIZ}/receipts/r1`]: receipt("unprocessed", "r1"),
    });
    await assertSucceeds(
      editor
        .doc(ePath("e1"))
        .set({
          ...expense("draft"),
          transactionId: "tx-draft",
          receiptId: "r1",
          createdBy: EDITOR,
        }),
    );
  });
});

describe("customers / projects の削除(R2-12)", () => {
  it("削除はownerのみ", async () => {
    await seed(testEnv, {
      [`businesses/${BIZ}/customers/c1`]: { name: "顧客" },
      [`businesses/${BIZ}/projects/pr1`]: {
        customerId: "c1",
        name: "案件",
        status: "active",
      },
    });
    const editor = asUser(testEnv, EDITOR);
    const owner = asUser(testEnv, OWNER);
    await assertFails(editor.doc(`businesses/${BIZ}/customers/c1`).delete());
    await assertFails(editor.doc(`businesses/${BIZ}/projects/pr1`).delete());
    await assertSucceeds(owner.doc(`businesses/${BIZ}/customers/c1`).delete());
    await assertSucceeds(owner.doc(`businesses/${BIZ}/projects/pr1`).delete());
  });
});

describe("デフォルト拒否", () => {
  it("未定義のコレクション・パスへは書き込めない", async () => {
    const owner = asUser(testEnv, OWNER);
    await assertFails(owner.doc("anything/x").set({ a: 1 }));
    await assertFails(owner.doc(`businesses/${BIZ}/unknownCol/x`).set({ a: 1 }));
  });
});
