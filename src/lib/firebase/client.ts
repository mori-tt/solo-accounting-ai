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

let emulatorsConnected = false;

function connectEmulators(app: FirebaseApp): void {
  if (emulatorsConnected) return;
  emulatorsConnected = true;

  const authEndpoint = parseEmulatorHost(
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
    EMULATOR_DEFAULTS.auth,
  );
  connectAuthEmulator(
    getAuth(app),
    `http://${authEndpoint.host}:${authEndpoint.port}`,
  );

  const firestoreEndpoint = parseEmulatorHost(
    process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
    EMULATOR_DEFAULTS.firestore,
  );
  connectFirestoreEmulator(
    getFirestore(app),
    firestoreEndpoint.host,
    firestoreEndpoint.port,
  );

  const storageEndpoint = parseEmulatorHost(
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST,
    EMULATOR_DEFAULTS.storage,
  );
  connectStorageEmulator(
    getStorage(app),
    storageEndpoint.host,
    storageEndpoint.port,
  );
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
