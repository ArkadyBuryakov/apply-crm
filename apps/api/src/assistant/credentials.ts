// Users' model provider API keys (ADR 0031): AES-256-GCM under a key derived from BETTER_AUTH_SECRET.
// Rotating the secret makes stored keys unreadable; users then enter them again.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { aiCredential, type Db } from "@crm/db";
import type { AiProvider } from "@crm/shared";
import { and, eq } from "drizzle-orm";

const FORMAT = "v1";

function encryptionKey(secret: string) {
  return Buffer.from(hkdfSync("sha256", secret, "", "apply-crm/ai-credential", 32));
}

export function encryptApiKey(secret: string, apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return `${FORMAT}.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

/** Returns null when the payload cannot be decrypted, e.g. after BETTER_AUTH_SECRET changed. */
export function decryptApiKey(secret: string, payload: string): string | null {
  const [format, data] = payload.split(".", 2);
  if (format !== FORMAT || !data) return null;
  const raw = Buffer.from(data, "base64");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function loadApiKey(db: Db, secret: string, userId: string, provider: AiProvider) {
  const [row] = await db
    .select({ encryptedKey: aiCredential.encryptedKey })
    .from(aiCredential)
    .where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, provider)));
  return row ? decryptApiKey(secret, row.encryptedKey) : null;
}

export async function loadApiKeys(db: Db, secret: string, userId: string) {
  const rows = await db
    .select({ provider: aiCredential.provider, encryptedKey: aiCredential.encryptedKey })
    .from(aiCredential)
    .where(eq(aiCredential.userId, userId));
  const keys = new Map<AiProvider, string>();
  for (const row of rows) {
    const key = decryptApiKey(secret, row.encryptedKey);
    if (key) keys.set(row.provider as AiProvider, key);
  }
  return keys;
}
