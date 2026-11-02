import "client-only";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from "firebase/storage";
import { assertFirebaseClientEnvOnce } from "@/lib/env";
import {
  EMULATOR_DEFAULTS,
  getFirebaseConfig,
  parseEmulatorHost,
  shouldUseEmulator,
} from "./config";

// 接続済みマーカーは app インスタンス側に持たせる。
// Fast Refresh で本モジュールが再評価されても getApps()[0] 経由で
// app インスタンスは生き残るため、モジュールスコープのフラグでは
// HMR 後に二重接続(connectFirestoreEmulator の FAILED_PRECONDITION)
// を引き起こす。
type EmulatorMarkedApp = FirebaseApp & { __saiEmulatorsConnected?: boolean };

/**
 * 「既に接続済み」系のエラーは冪等成功として扱う。
 * 前回の評価で途中まで接続していた場合の自己修復用。
 */
function ignoreAlreadyConnected(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // "already been started"(Firestore)/"already been used"(Auth) 等を拾う
    if (!/already (been )?(connected|configured|started|used)/i.test(message)) {
      throw e;
    }
  }
}

function connectEmulators(app: FirebaseApp): void {
  const marked = app as EmulatorMarkedApp;
  if (marked.__saiEmulatorsConnected) return;

  const authEndpoint = parseEmulatorHost(
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
    EMULATOR_DEFAULTS.auth,
  );
  ignoreAlreadyConnected(() =>
    connectAuthEmulator(
      getAuth(app),
      `http://${authEndpoint.host}:${authEndpoint.port}`,
    ),
  );

  const firestoreEndpoint = parseEmulatorHost(
    process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
    EMULATOR_DEFAULTS.firestore,
  );
  ignoreAlreadyConnected(() =>
    connectFirestoreEmulator(
      getFirestore(app),
      firestoreEndpoint.host,
      firestoreEndpoint.port,
    ),
  );

  const storageEndpoint = parseEmulatorHost(
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST,
    EMULATOR_DEFAULTS.storage,
  );
  ignoreAlreadyConnected(() =>
    connectStorageEmulator(
      getStorage(app),
      storageEndpoint.host,
      storageEndpoint.port,
    ),
  );

  // 全サービスの接続が終わってからマークする(途中失敗時は再試行可能にする)
  marked.__saiEmulatorsConnected = true;
}

export function getFirebaseApp(): FirebaseApp {
  // 必須envの未設定をSDK内部エラーではなく明示的なメッセージで失敗させる
  assertFirebaseClientEnvOnce();
  const existing = getApps()[0];
  const app = existing ?? initializeApp(getFirebaseConfig());
  if (shouldUseEmulator()) {
    connectEmulators(app);
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getFirebaseDb(): Firestore {
  return getFirestore(getFirebaseApp());
}

export function getFirebaseStorage(): FirebaseStorage {
  return getStorage(getFirebaseApp());
}
