import { db, DBorTx } from "@/db";
import { attachments, fileBlobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Actor } from "./actor";
import { NotFoundError, ValidationError } from "@/lib/errors";
import crypto from "node:crypto";
import path from "node:path";

export interface UploadFile { name: string; type: string; bytes: Buffer }

const ALLOWED: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "application/pdf": { ext: ".pdf", magic: (b) => b.subarray(0, 4).toString() === "%PDF" },
  "image/jpeg": { ext: ".jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  "image/png": { ext: ".png", magic: (b) => b.subarray(1, 4).toString() === "PNG" },
  "image/webp": { ext: ".webp", magic: (b) => b.subarray(8, 12).toString() === "WEBP" },
};

/** Default 4 MB: serverless hosts such as Vercel reject request bodies above ~4.5 MB. */
export const maxUpload = () => Number(process.env.MAX_UPLOAD_BYTES || 4 * 1024 * 1024);

/** Validate type (by declared MIME *and* file signature) and size. */
export function validateUpload(f: UploadFile, opts: { images?: boolean } = {}) {
  if (!f.bytes.length) throw new ValidationError("The uploaded file is empty.");
  if (f.bytes.length > maxUpload()) throw new ValidationError(`File is too large (max ${(maxUpload() / 1048576).toFixed(0)} MB).`);
  const rule = ALLOWED[f.type];
  if (!rule || (opts.images && f.type === "application/pdf")) throw new ValidationError("Only PDF, JPG, PNG or WEBP files are allowed.");
  if (!rule.magic(f.bytes)) throw new ValidationError("The file content does not match its type.");
  return rule.ext;
}

/** Stores the bytes in the database (works on hosts without a persistent disk). */
export async function storeFile(f: UploadFile, opts: { images?: boolean } = {}, tx: DBorTx = db) {
  const ext = validateUpload(f, opts);
  const storedName = crypto.randomBytes(16).toString("hex") + ext;
  await tx.insert(fileBlobs).values({ storedName, mime: f.type, size: f.bytes.length, bytes: f.bytes });
  return storedName;
}

export async function saveAttachment(tx: DBorTx, actor: Actor, entityType: string, entityId: number, f: UploadFile) {
  const storedName = await storeFile(f, {}, tx);
  const [a] = await tx.insert(attachments).values({
    entityType, entityId, fileName: path.basename(f.name).slice(0, 200), storedName, mime: f.type, size: f.bytes.length, uploadedBy: actor.id,
  }).returning();
  return a;
}

export async function readStored(storedName: string) {
  if (!/^[a-f0-9]{32}\.(pdf|jpg|png|webp)$/.test(storedName)) throw new ValidationError("Invalid file reference");
  const [f] = await db.select({ bytes: fileBlobs.bytes }).from(fileBlobs).where(eq(fileBlobs.storedName, storedName));
  if (!f) throw new NotFoundError("File");
  return Buffer.from(f.bytes);
}
