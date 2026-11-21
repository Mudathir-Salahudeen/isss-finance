import { getSettings } from "@/server/services/admin";
import { readStored } from "@/server/files";
import { NextResponse } from "next/server";

export async function GET() {
  const s = await getSettings();
  if (!s.logoPath) return new NextResponse(null, { status: 404 });
  const buf = await readStored(s.logoPath);
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": s.logoPath.endsWith(".png") ? "image/png" : s.logoPath.endsWith(".webp") ? "image/webp" : "image/jpeg", "cache-control": "public, max-age=300" } });
}
