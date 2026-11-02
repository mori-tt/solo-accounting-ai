"use server";

import { registerBusiness } from "@/lib/accounting/services/business";
import { auditsFor } from "@/lib/accounting/services/common";
import type {
  Business,
  CustomAccount,
  MemberRole,
} from "@/lib/accounting/types";
import { getAdminBucket, getAdminDb } from "@/lib/firebase/admin";
import {
  findUidByEmail,
  deleteMember,
  getUserProfile,
  listMembers,
  listMyBusinessIds,
  putMember,
  writeAuditLog,
  type MemberInfo,
  type UserProfile,
} from "@/lib/api/queries";
import { effectiveOwnerUids } from "@/lib/api/member-role";
import { fail, run, type ActionResult } from "@/lib/api/result";
import { ApiError } from "@/lib/api/result";
import {
  actionBulkRateLimiter,
  actionReadRateLimiter,
  actionWriteRateLimiter,
  businessCreateRateLimiter,
} from "@/lib/api/rate-limit";
import {
  requireMembership,
  requireOwner,
  requireUid,
} from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  businessSchema,
  memberInviteSchema,
  parseForm,
  type BusinessInput,
  type MemberInviteInput,
} from "@/lib/validation/schemas";

export interface MyBusiness {
  id: string;
  name: string;
  role: MemberRole;
  fiscalYearStartMonth: number;
  taxMode: string;
  customAccounts?: CustomAccount[];
  /** 家事按分の事業割合(科目コード→0-100)。未設定科目は100%扱い */
  allocationRatios?: Record<string, number>;
  /** 最終バックアップ(エクスポート)日時。未取得は undefined */
  lastBackupAt?: string;
  /** 適格請求書発行事業者の登録番号(T+13桁)。未登録は未設定 */
  invoiceRegistrationNumber?: string;
  /** 請求書の発行者名。未設定時は事業名を使う */
  issuerName?: string;
  /** 請求書に記載する発行者住所 */
  issuerAddress?: string;
}

/** ログインユーザーが所属する事業一覧 */
export async function listMyBusinesses(): Promise<
  ActionResult<MyBusiness[]>
> {
  return run(async () => {
    const uid = await requireUid();
    actionReadRateLimiter.consume(uid);
    const db = getAdminDb();
    const ids = await listMyBusinessIds(uid);
    const result: MyBusiness[] = [];
    for (const id of ids) {
      const business = await getStore().getBusiness(id);
      if (!business) continue;
      const member = await db
        .collection("businesses")
        .doc(id)
        .collection("members")
        .doc(uid)
        .get();
      const role: MemberRole =
        (member.data()?.role as MemberRole | undefined) ??
        (business.ownerUid === uid ? "owner" : "viewer");
      result.push({
        id,
        name: business.name,
        role,
        fiscalYearStartMonth: business.fiscalYearStartMonth,
        taxMode: business.taxMode,
        customAccounts: business.customAccounts,
        allocationRatios: business.allocationRatios,
        lastBackupAt: business.lastBackupAt,
        invoiceRegistrationNumber: business.invoiceRegistrationNumber,
        issuerName: business.issuerName,
        issuerAddress: business.issuerAddress,
      });
    }
    return result;
  });
}

export async function getMyProfile(): Promise<ActionResult<UserProfile>> {
  return run(async () => {
    const uid = await requireUid();
    actionReadRateLimiter.consume(uid);
    return getUserProfile(uid);
  });
}

/** 事業の新規作成。作成者をownerメンバーとして登録する。 */
export async function createBusiness(
  input: BusinessInput & { idempotencyKey?: string },
): Promise<ActionResult<MyBusiness>> {
  const parsed = parseForm(businessSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const uid = await requireUid();
    // businessId単位のレート制限を新規作成で増殖させないため、
    // 作成数をuid単位で制限する(R2-7)
    businessCreateRateLimiter.consume(uid);
    const { business } = await registerBusiness(getStore(), { uid }, {
      name: parsed.data.name,
      ownerUid: uid,
      fiscalYearStartMonth: parsed.data.fiscalYearStartMonth,
      taxMode: parsed.data.taxMode,
      invoiceRegistrationNumber:
        parsed.data.invoiceRegistrationNumber || undefined,
      issuerName: parsed.data.issuerName || undefined,
      issuerAddress: parsed.data.issuerAddress || undefined,
      idempotencyKey: input.idempotencyKey,
    });
    await putMember(business.id, {
      uid,
      role: "owner",
      invitedBy: uid,
    });
    return {
      id: business.id,
      name: business.name,
      role: "owner" as const,
      fiscalYearStartMonth: business.fiscalYearStartMonth,
      taxMode: business.taxMode,
    };
  });
}

/** 事業設定の更新(オーナーのみ) */
export async function updateBusinessSettings(
  businessId: string,
  input: BusinessInput,
): Promise<ActionResult<Business>> {
  const parsed = parseForm(businessSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireOwner(businessId);
    actionWriteRateLimiter.consume(businessId);
    const store = getStore();
    const { value } = await store.transact(businessId, {}, async (tx) => {
      const current = await tx.getBusiness(businessId);
      if (!current) {
        throw new ApiError("NOT_FOUND", "事業が見つかりません");
      }
      const next: Business = {
        ...current,
        name: parsed.data.name,
        fiscalYearStartMonth: parsed.data.fiscalYearStartMonth,
        taxMode: parsed.data.taxMode,
        updatedAt: new Date().toISOString(),
      };
      // 按分タブからの保存時のみ上書き。未指定(従来の設定画面)は現値を維持する
      if (parsed.data.allocationRatios !== undefined) {
        next.allocationRatios = parsed.data.allocationRatios;
      }
      // インボイス関連項目も未指定は現値維持。空文字は未設定(クリア)扱い
      if (parsed.data.invoiceRegistrationNumber !== undefined) {
        next.invoiceRegistrationNumber =
          parsed.data.invoiceRegistrationNumber || undefined;
      }
      if (parsed.data.issuerName !== undefined) {
        next.issuerName = parsed.data.issuerName || undefined;
      }
      if (parsed.data.issuerAddress !== undefined) {
        next.issuerAddress = parsed.data.issuerAddress || undefined;
      }
      return {
        batch: {
          puts: [{ collection: "businesses" as const, id: businessId, data: next }],
          audits: auditsFor(
            businessId,
            [{ collection: "businesses", id: businessId }],
            "update",
            actor,
          ),
        },
        value: next,
      };
    });
    return value;
  });
}

export async function listBusinessMembers(
  businessId: string,
): Promise<ActionResult<MemberInfo[]>> {
  return run(async () => {
    const actor = await requireMembership(businessId, "viewer");
    actionReadRateLimiter.consume(actor.uid);
    return listMembers(businessId);
  });
}

/**
 * apply でmemberロールの変更を適用した後も実効ownerが残ることを確認する。
 * 最後のownerの降格・削除(非ownerロールでの再招待による降格を含む)を防ぐ。
 */
async function assertOwnerRemains(
  businessId: string,
  apply: (roles: Map<string, unknown>) => void,
): Promise<void> {
  const db = getAdminDb();
  const businessRef = db.collection("businesses").doc(businessId);
  const [businessSnap, membersSnap] = await Promise.all([
    businessRef.get(),
    businessRef.collection("members").get(),
  ]);
  const roles = new Map<string, unknown>(
    membersSnap.docs.map((d) => [d.id, d.data().role]),
  );
  apply(roles);
  if (effectiveOwnerUids(roles, businessSnap.data()?.ownerUid).size === 0) {
    throw new ApiError(
      "FORBIDDEN",
      "事業のオーナーがいなくなるため、この操作はできません",
    );
  }
}

/** businessドキュメントのownerUidを取得する */
async function getOwnerUid(businessId: string): Promise<string> {
  const snap = await getAdminDb()
    .collection("businesses")
    .doc(businessId)
    .get();
  const ownerUid = snap.data()?.ownerUid;
  if (!snap.exists || typeof ownerUid !== "string") {
    throw new ApiError("NOT_FOUND", "事業が見つかりません");
  }
  return ownerUid;
}

/** メンバー招待(オーナーのみ)。メールアドレスでAuthユーザーを引く。 */
export async function inviteMember(
  businessId: string,
  input: MemberInviteInput,
): Promise<ActionResult<{ uid: string }>> {
  const parsed = parseForm(memberInviteSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireOwner(businessId);
    actionWriteRateLimiter.consume(businessId);
    const uid = await findUidByEmail(parsed.data.email);
    if (!uid) {
      throw new ApiError(
        "NOT_FOUND",
        "そのメールアドレスのユーザーが見つかりません。先にログイン画面でアカウント作成してもらってください。",
      );
    }
    // 既存メンバーへの再招待はロール変更と同義のため、最後のownerの
    // 降格にならないか確認する(新規メンバーの追加はowner数を減らさない)
    await assertOwnerRemains(businessId, (roles) =>
      roles.set(uid, parsed.data.role),
    );
    // 招待はmemberドキュメントをset(merge)で上書きするため、
    // 自分自身・事業owner(ownerUid)を対象にするとロールが書き換わり
    // owner不在/乗っ取りの不可逆ロックアウトになる(R2-4)
    if (uid === actor.uid) {
      throw new ApiError(
        "FORBIDDEN",
        "自分自身を招待することはできません",
      );
    }
    if (uid === (await getOwnerUid(businessId))) {
      throw new ApiError(
        "FORBIDDEN",
        "事業のオーナーのロールは変更できません",
      );
    }
    await putMember(businessId, {
      uid,
      role: parsed.data.role,
      invitedBy: actor.uid,
    });
    await writeAuditLog(businessId, {
      actorUid: actor.uid,
      action: "update",
      targetPath: `businesses/${businessId}/members/${uid}`,
    });
    return { uid };
  });
}

/** メンバーロール変更(オーナーのみ)。owner自体の降格は禁止。 */
export async function updateMemberRole(
  businessId: string,
  memberUid: string,
  role: Exclude<MemberRole, "owner">,
): Promise<ActionResult<null>> {
  return run(async () => {
    const actor = await requireOwner(businessId);
    actionWriteRateLimiter.consume(businessId);
    if (memberUid === actor.uid) {
      throw new ApiError(
        "FORBIDDEN",
        "自分自身のロールは変更できません",
      );
    }
    // 別オーナー経由で ownerUid のmemberを降格されると
    // 真のオーナーがviewer転落し乗っ取り・ロックアウトになる(R2-4)
    if (memberUid === (await getOwnerUid(businessId))) {
      throw new ApiError(
        "FORBIDDEN",
        "事業のオーナーのロールは変更できません",
      );
    }
    if (role !== "editor" && role !== "viewer") {
      throw new ApiError("INVALID_INPUT", "ロールが不正です");
    }
    await assertOwnerRemains(businessId, (roles) =>
      roles.set(memberUid, role),
    );
    await putMember(businessId, { uid: memberUid, role, invitedBy: actor.uid });
    await writeAuditLog(businessId, {
      actorUid: actor.uid,
      action: "update",
      targetPath: `businesses/${businessId}/members/${memberUid}`,
    });
    return null;
  });
}

/**
 * 事業の完全削除(オーナーのみ)。
 * 確認として事業名の完全一致を要求し、Firestoreのbusinessドキュメントと
 * 全サブコレクションを再帰削除する(members/transactions/expenses/
 * receipts/customers/projects/invoices/payments/bills/billPayments/
 * journalEntries/recurringTemplates/closingChecks/aiSuggestions/monthlySummaries/
 * fiscalPeriods/auditLogs/idempotencyKeys が実在コレクション。
 * recursiveDelete が存在する全コレクションを処理するため列挙は網羅確認用)
 * に加え、Storageの receipts/{businessId}/
 * 配下も削除する。users/{uid}・Firebase Authアカウントは残る。
 * 監査ログは事業と共に消えるため削除操作自体のログは残らない。
 */
export async function deleteBusiness(
  businessId: string,
  confirmName: string,
): Promise<ActionResult<null>> {
  return run(async () => {
    await requireOwner(businessId);
    actionBulkRateLimiter.consume(businessId);
    const db = getAdminDb();
    const businessRef = db.collection("businesses").doc(businessId);
    const snap = await businessRef.get();
    if (!snap.exists) {
      throw new ApiError("NOT_FOUND", "事業が見つかりません");
    }
    if (snap.data()?.name !== confirmName) {
      throw new ApiError(
        "INVALID_INPUT",
        "確認のための事業名が一致しません",
      );
    }
    // 先にStorageの証憑ファイルを消す。先にFirestoreを消すと
    // 失敗時にファイルの残骸を事業単位で追えなくなるため
    await getAdminBucket().deleteFiles({
      prefix: `receipts/${businessId}/`,
    });
    // businessドキュメント + 全サブコレクションを再帰削除(Admin SDK)
    await db.recursiveDelete(businessRef);
    return null;
  });
}

/** メンバー削除(オーナーのみ・自分以外) */
export async function removeMember(
  businessId: string,
  memberUid: string,
): Promise<ActionResult<null>> {
  return run(async () => {
    const actor = await requireOwner(businessId);
    actionWriteRateLimiter.consume(businessId);
    if (memberUid === actor.uid) {
      throw new ApiError("FORBIDDEN", "自分自身は削除できません");
    }
    await assertOwnerRemains(businessId, (roles) => roles.delete(memberUid));
    // ownerUid のmember削除も降格と同じくロックアウトを招く(R2-4)
    if (memberUid === (await getOwnerUid(businessId))) {
      throw new ApiError(
        "FORBIDDEN",
        "事業のオーナーは削除できません",
      );
    }
    await deleteMember(businessId, memberUid);
    await writeAuditLog(businessId, {
      actorUid: actor.uid,
      action: "delete",
      targetPath: `businesses/${businessId}/members/${memberUid}`,
    });
    return null;
  });
}
