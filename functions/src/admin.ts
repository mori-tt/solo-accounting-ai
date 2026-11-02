import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/**
 * Admin SDK の遅延初期化。Cloud Functions 実行環境では
 * 引数なしの initializeApp() が実行サービスアカウントの
 * 資格情報とプロジェクト(GOOGLE_CLOUD_PROJECT)を使う。
 * 個人情報・証憑内容を扱うため Security Rules をバイパスする
 * Admin SDK の利用はこのモジュール経由に限定する。
 */
export function adminApp(): App {
  return getApps()[0] ?? initializeApp();
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}

/**
 * バックアップ出力先バケット。
 * BACKUP_STORAGE_BUCKET があればそれを使い、なければ
 * プロジェクト既定バケット({projectId}.appspot.com 等)を使う。
 */
export function adminBucket() {
  return getStorage(adminApp()).bucket(
    process.env.BACKUP_STORAGE_BUCKET ?? undefined,
  );
}
