import { withActor, fileResponse } from "@/server/http";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readStored } from "@/server/files";
import { getPayment } from "@/server/services/payments";
import { getExpense } from "@/server/services/expenses";
import { NotFoundError } from "@/lib/errors";

/** Evidence files are served only after checking the user may see the record they belong to. */
export const GET = withActor<{ params: Promise<{ id: string }> }>(async (actor, _req, { params }) => {
  const [a] = await db.select().from(attachments).where(eq(attachments.id, Number((await params).id)));
  if (!a) throw new NotFoundError("File");
  if (a.entityType === "payment") await getPayment(actor, a.entityId);
  else if (a.entityType === "expense") await getExpense(actor, a.entityId);
  else throw new NotFoundError("File");
  return fileResponse(await readStored(a.storedName), a.fileName, a.mime, true);
});
