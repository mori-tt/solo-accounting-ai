import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  BIZ,
  EDITOR,
  OTHER_BIZ,
  OUTSIDER,
  OWNER,
  seedBusiness,
  VIEWER,
  createTestEnv,
} from "./helpers";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await createTestEnv();
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await seedBusiness(
    testEnv,
    BIZ,
    { [OWNER]: "owner", [EDITOR]: "editor", [VIEWER]: "viewer" },
    OWNER,
  );
  await seedBusiness(testEnv, OTHER_BIZ, { [OUTSIDER]: "owner" }, OUTSIDER);
});

const anonStorage = () => testEnv.unauthenticatedContext().storage();
const userStorage = (uid: string) => testEnv.authenticatedContext(uid).storage();

const path = (biz: string, file = "r1.png") => `receipts/${biz}/r1/${file}`;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

// UploadTask は thenable なので Promise に変換してから assert* へ渡す
function put(
  storage: ReturnType<typeof userStorage>,
  filePath: string,
  data: Uint8Array,
  contentType: string,
): Promise<unknown> {
  return storage.ref(filePath).put(data, { contentType }).then(() => undefined);
}

async function seedFile(filePath: string, data = png) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref(filePath).put(data, { contentType: "image/png" });
  });
}

describe("未認証ユーザー", () => {
  it("読み取りもアップロードもできない", async () => {
    await seedFile(path(BIZ));
    await assertFails(anonStorage().ref(path(BIZ)).getDownloadURL());
    await assertFails(put(anonStorage(), path(BIZ, "new.png"), png, "image/png"));
  });
});

describe("別businessIdへのアクセス", () => {
  it("他businessの証憑を読み取れない", async () => {
    await seedFile(path(OTHER_BIZ));
    await assertFails(userStorage(OWNER).ref(path(OTHER_BIZ)).getDownloadURL());
  });

  it("他businessの証憑パスへ書き込めない", async () => {
    await assertFails(put(userStorage(EDITOR), path(OTHER_BIZ, "x.png"), png, "image/png"));
    await assertFails(userStorage(OWNER).ref(path(OTHER_BIZ)).delete());
  });

  it("receipts/配下以外のパスにはアクセスできない", async () => {
    await assertFails(put(userStorage(OWNER), `other/${BIZ}/f.png`, png, "image/png"));
    await assertFails(userStorage(OWNER).ref(`other/${BIZ}/f.png`).getDownloadURL());
  });
});

describe("member権限", () => {
  beforeEach(async () => {
    await seedFile(path(BIZ));
  });

  it("viewerは読み取りのみ", async () => {
    const storage = userStorage(VIEWER);
    await assertSucceeds(storage.ref(path(BIZ)).getDownloadURL());
    await assertFails(put(storage, path(BIZ, "v.png"), png, "image/png"));
    await assertFails(storage.ref(path(BIZ)).delete());
  });

  it("editorはアップロード・削除できる", async () => {
    const storage = userStorage(EDITOR);
    await assertSucceeds(put(storage, path(BIZ, "e.png"), png, "image/png"));
    await assertSucceeds(storage.ref(path(BIZ)).delete());
  });

  it("ownerはアップロード・削除できる", async () => {
    const storage = userStorage(OWNER);
    await assertSucceeds(put(storage, path(BIZ, "o.pdf"), png, "application/pdf"));
    await assertSucceeds(storage.ref(path(BIZ)).delete());
  });
});

describe("ファイル制限", () => {
  it("許可外のMIMEタイプはアップロードできない", async () => {
    await assertFails(
      put(userStorage(EDITOR), path(BIZ, "evil.txt"), new Uint8Array([1, 2, 3]), "text/plain"),
    );
  });

  it("10MBを超えるファイルはアップロードできない", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    await assertFails(put(userStorage(OWNER), path(BIZ, "big.png"), big, "image/png"));
  });

  it("許可するMIMEタイプはアップロードできる", async () => {
    const storage = userStorage(EDITOR);
    for (const [file, contentType] of [
      ["a.jpg", "image/jpeg"],
      ["a.webp", "image/webp"],
      ["a.pdf", "application/pdf"],
    ] as const) {
      await assertSucceeds(put(storage, path(BIZ, file), png, contentType));
    }
  });
});
