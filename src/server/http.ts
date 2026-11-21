import "server-only";
import { NextResponse } from "next/server";
import { getActor } from "./session";
import { Actor } from "./actor";
import { AppError } from "@/lib/errors";

export function withActor<C>(fn: (actor: Actor, req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    try {
      return await fn(actor, req, ctx);
    } catch (e) {
      if (e instanceof AppError) return new NextResponse(e.message, { status: e.status, headers: { "content-type": "text/plain; charset=utf-8" } });
      console.error(e);
      return new NextResponse("Unexpected error", { status: 500 });
    }
  };
}

export function fileResponse(buf: Buffer, name: string, type: string, inline = false) {
  return new NextResponse(new Uint8Array(buf), { headers: {
    "content-type": type, "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\w.\-]/g, "_")}"`,
    "cache-control": "private, no-store", "x-content-type-options": "nosniff",
  } });
}

export const searchParamsOf = (req: Request) => Object.fromEntries(new URL(req.url).searchParams.entries());
