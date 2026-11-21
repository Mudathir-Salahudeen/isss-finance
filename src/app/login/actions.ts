"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout } from "@/server/services/auth";
import { SESSION_COOKIE, reqMeta, getActor } from "@/server/session";
import { AppError } from "@/lib/errors";

export async function loginAction(_prev: { error?: string } | null, fd: FormData) {
  const { ip, userAgent } = await reqMeta();
  let r;
  try {
    r = await login(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""), ip, userAgent);
  } catch (e) {
    return { error: e instanceof AppError ? e.message : "Sign-in failed." };
  }
  (await cookies()).set(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: r.expiresHours * 3600 });
  redirect(r.mustChangePassword ? "/account" : "/dashboard");
}

export async function logoutAction() {
  const c = await cookies();
  await logout(c.get(SESSION_COOKIE)?.value, await getActor());
  c.delete(SESSION_COOKIE);
  redirect("/login");
}
