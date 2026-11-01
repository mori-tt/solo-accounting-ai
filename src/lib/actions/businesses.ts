"use server";

import { registerBusiness } from "@/lib/accounting/services/business";
import { auditsFor } from "@/lib/accounting/services/common";
import type {
  Business,
  CustomAccount,
  MemberRole,
} from "@/lib/accounting/types";
import { getAdminDb } from "@/lib/firebase/admin";
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
import { fail, run, type ActionResult } from "@/lib/api/result";
import { ApiError } from "@/lib/api/result";
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
}

/** ログインユーザーが所属する事業一覧 */
export async function listMyBusinesses(): Promise<
  ActionResult<MyBusiness[]>
> {
  return run(async () => {
    const uid = await requireUid();
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
      });
    }
    return result;
  });
}

export async function getMyProfile(): Promise<ActionResult<UserProfile>> {
  return run(async () => getUserProfile(await requireUid()));
}

/** 事業の新規作成。作成者をownerメンバーとして登録する。 */
export async function createBusiness(
  input: BusinessInput & { idempotencyKey?: string },
): Promise<ActionResult<MyBusiness>> {
  const parsed = parseForm(businessSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const uid = await requireUid();
    const { business } = await registerBusiness(getStore(), { uid }, {
      name: parsed.data.name,
      ownerUid: uid,
      fiscalYearStartMonth: parsed.data.fiscalYearStartMonth,
      taxMode: parsed.data.taxMode,
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
    await requireMembership(businessId, "viewer");
    return listMembers(businessId);
  });
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
    const uid = await findUidByEmail(parsed.data.email);
    if (!uid) {
      throw new ApiError(
        "NOT_FOUND",
        "そのメールアドレスのユーザーが見つかりません。先にログイン画面でアカウント作成してもらってください。",
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
    if (memberUid === actor.uid) {
      throw new ApiError(
        "FORBIDDEN",
        "自分自身のロールは変更できません",
      );
    }
    if (role !== "editor" && role !== "viewer") {
      throw new ApiError("INVALID_INPUT", "ロールが不正です");
    }
    await putMember(businessId, { uid: memberUid, role, invitedBy: actor.uid });
    await writeAuditLog(businessId, {
      actorUid: actor.uid,
      action: "update",
      targetPath: `businesses/${businessId}/members/${memberUid}`,
    });
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
    if (memberUid === actor.uid) {
      throw new ApiError("FORBIDDEN", "自分自身は削除できません");
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
