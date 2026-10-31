import { cookies } from "next/headers";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { ActorContext } from "@/lib/accounting/services/common";
import type { MemberRole } from "@/lib/accounting/types";
import { ApiError } from "./result";

/**
 * セッションCookie名。内容はFirebase IDトークン(短命・httpOnly)。
 * Cookieの設定・削除は src/app/api/session/route.ts が行う。
 */
export const SESSION_COOKIE = "__session";

/** Cookie内のIDトークンを検証し uid を返す。未ログイン/失効時は undefined。 */
export async function getSessionUid(): Promise<string | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return undefined;
  }
}

/** ログイン必須のコンテキスト。未ログインなら UNAUTHORIZED。 */
export async function requireUid(): Promise<string> {
  const uid = await getSessionUid();
  if (!uid) {
    throw new ApiError("UNAUTHORIZED", "ログインが必要です");
  }
  return uid;
}

const ROLE_RANK: Record<MemberRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

export interface MemberContext extends ActorContext {
  role: MemberRole;
}

/**
 * businessId への membership を検証する。
 * businessId をまたいだアクセスはここで遮断する(REQUIREMENTS.md 非機能要件)。
 * minRole 未満のロールなら FORBIDDEN。
 */
export async function requireMembership(
  businessId: string,
  minRole: MemberRole = "viewer",
): Promise<MemberContext> {
  const uid = await requireUid();
  const db = getAdminDb();

  const memberSnap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("members")
    .doc(uid)
    .get();

  let role = memberSnap.data()?.role as MemberRole | undefined;

  if (role === undefined) {
    // memberドキュメントが無い場合、business所有者でもなければ非メンバー
    const businessSnap = await db.collection("businesses").doc(businessId).get();
    if (!businessSnap.exists) {
      throw new ApiError("NOT_FOUND", "事業が見つかりません");
    }
    if (businessSnap.data()?.ownerUid === uid) {
      role = "owner";
    } else {
      throw new ApiError("FORBIDDEN", "この事業へのアクセス権がありません");
    }
  }

  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    throw new ApiError("FORBIDDEN", "この操作を行う権限がありません");
  }
  return { uid, role };
}

/** 閲覧(viewer以上) */
export function requireViewer(businessId: string): Promise<MemberContext> {
  return requireMembership(businessId, "viewer");
}

/** 編集(editor以上) */
export function requireEditor(businessId: string): Promise<MemberContext> {
  return requireMembership(businessId, "editor");
}

/** オーナー限定(締め・メンバー管理・事業設定) */
export function requireOwner(businessId: string): Promise<MemberContext> {
  return requireMembership(businessId, "owner");
}
