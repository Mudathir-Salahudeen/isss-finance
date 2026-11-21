import { getSettings } from "@/server/services/admin";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  const s = await getSettings();
  return <LoginForm schoolName={s.schoolName} hasLogo={!!s.logoPath} />;
}
