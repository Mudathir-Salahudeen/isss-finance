import { resetDatabase, seedDemo } from "../scripts/seed";
import { db } from "@/db";
import { users, roles, paymentChannels, accounts, academicSessions, terms, classes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { actorForUser } from "@/server/services/auth";

export const PASSWORD = "TestPass123!";
export const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

export async function freshDemo(students = 16) {
  await resetDatabase();
  return seedDemo({ students, password: PASSWORD });
}
export async function actorByEmail(email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await actorForUser(u.id))!;
}
export async function ctx() {
  const [cur] = await db.select().from(academicSessions).where(eq(academicSessions.isCurrent, true));
  const [term] = await db.select().from(terms).where(eq(terms.isCurrent, true));
  const ch = await db.select().from(paymentChannels);
  const acc = await db.select().from(accounts);
  const cls = await db.select().from(classes);
  const rs = await db.select().from(roles);
  return { session: cur, term, channel: (n: string) => ch.find((c) => c.name === n)!.id, account: (n: string) => acc.find((a) => a.name.startsWith(n))!.id, classes: cls, roles: rs };
}
