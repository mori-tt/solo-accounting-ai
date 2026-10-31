import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// サーバーサイド専用。Route Handler / Server Action から使うこと。
// FIRESTORE_EMULATOR_HOST 等が設定された開発環境では
// 認証情報なしでEmulatorに接続する。本番認証情報はコミットしないこと。
export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp({
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
      "demo-solo-accounting-ai",
  });
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}
