import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { MemberRole } from "@/lib/accounting/types";

/**
 * AccountingReader に無い読み取り・単純書き込みのAdmin SDK実装。
 * ドメイン層の管轄外(users/membersコレクション、ドキュメント削除、
 * 一覧クエリ)だけをここに集約する。呼び出し前に session.ts で認可済みのこと。
 */

export interface MemberInfo {
  uid: string;
  role: MemberRole;
  invitedBy?: string;
  displayName?: string;
  email?: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
}

function businessDoc(db: Firestore, businessId: string) {
  return db.collection("businesses").doc(businessId);
}

/** ログインユーザーが所属する事業ID一覧(ownerUid一致 + members.uid一致) */
export async function listMyBusinessIds(uid: string): Promise<string[]> {
  const db = getAdminDb();
  const ids = new Set<string>();

  const owned = await db
    .collection("businesses")
    .where("ownerUid", "==", uid)
    .get();
  for (const d of owned.docs) ids.add(d.id);

  const memberships = await db
    .collectionGroup("members")
    .where("uid", "==", uid)
    .get();
  for (const d of memberships.docs) {
    const businessId = d.ref.parent.parent?.id;
    if (businessId) ids.add(businessId);
  }
  return [...ids];
}

export async function getUserProfile(uid: string): Promise<UserProfile> {
  const db = getAdminDb();
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.data();
  if (data) {
    return {
      uid,
      displayName: typeof data.displayName === "string" ? data.displayName : "",
      email: typeof data.email === "string" ? data.email : "",
    };
  }
  // usersドキュメント未作成でもFirebase Authの情報で補完する
  try {
    const user = await getAdminAuth().getUser(uid);
    return {
      uid,
      displayName: user.displayName ?? "",
      email: user.email ?? "",
    };
  } catch {
    return { uid, displayName: "", email: "" };
  }
}

/** users/{uid} を upsert。個人情報はこのコレクション内に限定する。 */
export async function upsertUserProfile(
  uid: string,
  profile: { displayName: string; email: string },
): Promise<void> {
  const db = getAdminDb();
  await db.collection("users").doc(uid).set(
    {
      displayName: profile.displayName,
      email: profile.email,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function listMembers(businessId: string): Promise<MemberInfo[]> {
  const db = getAdminDb();
  const snap = await businessDoc(db, businessId).collection("members").get();
  const members: MemberInfo[] = snap.docs.map((d) => ({
    uid: d.id,
    role: d.data().role as MemberRole,
    invitedBy: d.data().invitedBy,
  }));
  // 表示用にAuthの名前・メールを補完(失敗しても一覧は返す)
  const auth = getAdminAuth();
  await Promise.all(
    members.map(async (m) => {
      try {
        const u = await auth.getUser(m.uid);
        m.displayName = u.displayName ?? "";
        m.email = u.email ?? "";
      } catch {
        // 退会済み等は空のまま
      }
    }),
  );
  return members;
}

export async function findUidByEmail(
  email: string,
): Promise<string | undefined> {
  try {
    const u = await getAdminAuth().getUserByEmail(email);
    return u.uid;
  } catch {
    return undefined;
  }
}

/** memberドキュメントの作成・更新(オーナー操作) */
export async function putMember(
  businessId: string,
  member: { uid: string; role: MemberRole; invitedBy: string },
): Promise<void> {
  const db = getAdminDb();
  await businessDoc(db, businessId)
    .collection("members")
    .doc(member.uid)
    .set(
      {
        uid: member.uid,
        role: member.role,
        invitedBy: member.invitedBy,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function deleteMember(
  businessId: string,
  uid: string,
): Promise<void> {
  const db = getAdminDb();
  await businessDoc(db, businessId).collection("members").doc(uid).delete();
}

/** ドメインのtransact外で発生する削除等の監査ログを直接記録する。 */
export async function writeAuditLog(
  businessId: string,
  entry: { actorUid: string; action: string; targetPath: string },
): Promise<void> {
  const db = getAdminDb();
  await businessDoc(db, businessId).collection("auditLogs").add({
    actorUid: entry.actorUid,
    action: entry.action,
    targetPath: entry.targetPath,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/** Timestamp等をプレーンな値(Server Actionで返せる形)へ変換する */
function toPlain<T>(value: T): T {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (typeof v.toDate === "function") {
      return (v.toDate() as Date).toISOString() as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, item] of Object.entries(v)) out[k] = toPlain(item);
    return out as T;
  }
  if (Array.isArray(value)) return value.map(toPlain) as T;
  return value;
}

export async function listCustomersRaw(businessId: string) {
  const snap = await businessDoc(getAdminDb(), businessId)
    .collection("customers")
    .get();
  return snap.docs.map((d) => toPlain({ id: d.id, ...d.data() }));
}

export async function listProjectsRaw(businessId: string) {
  const snap = await businessDoc(getAdminDb(), businessId)
    .collection("projects")
    .get();
  return snap.docs.map((d) => toPlain({ id: d.id, ...d.data() }));
}

export async function listPaymentsRaw(businessId: string) {
  const snap = await businessDoc(getAdminDb(), businessId)
    .collection("payments")
    .get();
  return snap.docs.map((d) => toPlain({ id: d.id, ...d.data() }));
}

export async function deleteTransactionDoc(
  businessId: string,
  transactionId: string,
): Promise<void> {
  await businessDoc(getAdminDb(), businessId)
    .collection("transactions")
    .doc(transactionId)
    .delete();
}
