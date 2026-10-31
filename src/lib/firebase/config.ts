export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface EmulatorEndpoint {
  host: string;
  port: number;
}

export function getFirebaseConfig(): FirebaseClientConfig {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
}

export function shouldUseEmulator(): boolean {
  return process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
}

export const EMULATOR_DEFAULTS = {
  auth: { host: "localhost", port: 9099 },
  firestore: { host: "localhost", port: 8080 },
  storage: { host: "localhost", port: 9199 },
} as const;

export function parseEmulatorHost(
  value: string | undefined,
  fallback: EmulatorEndpoint,
): EmulatorEndpoint {
  if (!value) return fallback;
  const withoutScheme = value.replace(/^https?:\/\//, "");
  const [host, portString] = withoutScheme.split(":");
  const port = Number(portString);
  if (!host || !Number.isInteger(port)) return fallback;
  return { host, port };
}
