"use server";
import { getActor } from "@/server/session";
import { executePromotion, Decision, reversePromotion } from "@/server/services/promotion";
import { act, reqNum, str } from "@/server/action";
import { AppError } from "@/lib/errors";
import { revalidatePath } from "next/cache";

export async function runPromotion(input: { fromSessionId: number; toSessionId: number; decisions: Decision[] }) {
  const a = await getActor();
  if (!a) return { error: "Not signed in" };
  try {
    const r = await executePromotion(a, input);
    revalidatePath("/", "layout");
    return { ok: true, ...r };
  } catch (e) { return { error: e instanceof AppError ? e.message : "Promotion failed." }; }
}
export const reversePromotionAction = act(async (a, fd) => { await reversePromotion(a, reqNum(fd, "eventId"), str(fd, "reason")); return { message: "Promotion reversed." }; });
