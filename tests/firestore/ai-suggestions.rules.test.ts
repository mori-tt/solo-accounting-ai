import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

// Firebase Emulator 起動時(FIRESTORE_EMULATOR_HOST設定時)のみ実行する。
// 未起動の `pnpm test` ではskipされる。
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const describeIfEmulator = EMULATOR_HOST ? describe : describe.skip;

const PROJECT_ID = "demo-solo-accounting-ai";
const BUSINESS_ID = "biz-1";

describeIfEmulator("aiSuggestions Security Rules", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, portString] = (EMULATOR_HOST ?? "").split(":");
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host,
        port: Number(portString),
        rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  it("クライアントからaiSuggestionsへ書き込めない(Admin SDKのみ)", async () => {
    const uid = "user-1";
    const db = testEnv.authenticatedContext(uid).firestore();
    const ref = doc(
      db,
      "businesses",
      BUSINESS_ID,
      "aiSuggestions",
      "sug-1",
    );
    await assertFails(
      setDoc(ref, {
        kind: "receipt_extraction",
        status: "pending",
      }),
    );
  });

  it("クライアントからaiSuggestionsを読み取れない", async () => {
    const db = testEnv.authenticatedContext("user-1").firestore();
    await assertFails(
      getDocs(
        collection(db, "businesses", BUSINESS_ID, "aiSuggestions"),
      ),
    );
  });

  it("未認証でも同様に拒否される", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDocs(
        collection(db, "businesses", BUSINESS_ID, "aiSuggestions"),
      ),
    );
  });
});
