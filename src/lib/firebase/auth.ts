import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
  type UserCredential,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "./client";

// クライアントサイドの認証操作。Client Componentから呼ぶこと。

export function signInWithGoogle(): Promise<UserCredential> {
  return signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
}

export function signInWithEmail(
  email: string,
  password: string,
): Promise<UserCredential> {
  return signInWithEmailAndPassword(getFirebaseAuth(), email, password);
}

export function signUpWithEmail(
  email: string,
  password: string,
): Promise<UserCredential> {
  return createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
}

export function signOut(): Promise<void> {
  return firebaseSignOut(getFirebaseAuth());
}

// 初回ログイン時に users/{uid} を作成する(Security Rulesで本人のみ作成可)
export async function ensureUserDocument(user: User): Promise<void> {
  const ref = doc(getFirebaseDb(), "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: user.displayName ?? "",
      email: user.email ?? "",
      createdAt: serverTimestamp(),
    });
  }
}
