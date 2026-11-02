import "server-only";

import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/** サーバー側が参照するEmulator接続先の環境変数 */
const EMULATOR_ENV_VARS = [
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_STORAGE_EMULATOR_HOST",
] as const;

/**
 * Emulator宛先の環境変数を検証する。
 * 本番でこれらが設定されていると Admin SDK は認証情報なしで
 * そのホストへ接続する(fail-open)ため、設定自体を拒否する。
 * 開発時は host:port 形式のみ受理し、明らかな誤設定を早期に検出する。
 * (client用の NEXT_PUBLIC_*_EMULATOR_HOST 検証は src/lib/env.ts 側)
 */
function assertEmulatorEnvSafe(): void {
  for (const name of EMULATOR_ENV_VARS) {
    const value = process.env[name];
    if (value === undefined || value === "") continue;
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${name} must not be set in production`);
    }
    if (!/^[^\s:]+:\d{1,5}$/.test(value)) {
      throw new Error(`${name} must be in host:port form`);
    }
  }
}

/**
 * projectId を解決する。
 * 本番で projectId 未設定のまま demo-* へフォールバックすると、
 * 認証・データが意図しないプロジェクトへ向かう(fail-open)ため拒否する。
 * demo-* へのフォールバックは Emulator 開発時のみ許可する。
 */
function resolveProjectId(): string {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (projectId) return projectId;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT or NEXT_PUBLIC_FIREBASE_PROJECT_ID is required",
    );
  }
  return "demo-solo-accounting-ai";
}

// サーバーサイド専用。Route Handler / Server Action から使うこと。
// FIRESTORE_EMULATOR_HOST 等が設定された開発環境では
// 認証情報なしでEmulatorに接続する。本番認証情報はコミットしないこと。
export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  assertEmulatorEnvSafe();
  return initializeApp({
    projectId: resolveProjectId(),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminBucket() {
  return getStorage(getAdminApp()).bucket();
}
