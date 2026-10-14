import { PROVIDER_SEND_TURN_MAX_FILE_BYTES } from "@t3tools/contracts";

const DATABASE_NAME = "t3code:composer-attachment-bytes";
const STORE_NAME = "files";
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(STORE_NAME);
    });
    request.addEventListener("success", () => {
      const db = request.result;
      db.addEventListener("versionchange", () => {
        db.close();
        database = undefined;
      });
      resolve(db);
    });
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () => reject(new Error("Draft file storage is blocked.")));
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  }));
}

async function withStore<A>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<A>,
) {
  const transaction = (await openDatabase()).transaction(STORE_NAME, mode);
  const request = use(transaction.objectStore(STORE_NAME));
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  return request.result;
}

/** Local draft contents; failures leave the existing metadata-only fallback usable. */
export const composerAttachmentBytes = {
  put: async (id: string, file: File) => {
    if (file.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) return;
    await withStore("readwrite", (store) => store.put(file, id));
  },
  get: async (id: string): Promise<Blob | null> => {
    const value: unknown = await withStore("readonly", (store) => store.get(id));
    return value instanceof Blob ? value : null;
  },
  remove: async (id: string) => {
    await withStore("readwrite", (store) => store.delete(id));
  },
  keys: async () => {
    const keys = await withStore("readonly", (store) => store.getAllKeys());
    return keys.filter((key): key is string => typeof key === "string");
  },
};
