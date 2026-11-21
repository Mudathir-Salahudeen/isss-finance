/**
 * Production first-run setup: applies migrations, creates default roles/categories/channels,
 * and creates the first Director account from BOOTSTRAP_DIRECTOR_EMAIL / BOOTSTRAP_DIRECTOR_PASSWORD.
 * Safe to re-run: it never overwrites existing data and only creates the Director if no users exist.
 */
import "dotenv/config";
import { runMigrations } from "./migrate";
import { setupBase, createFirstDirector } from "@/server/setup";
import { closeDb } from "@/db";

(async () => {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    // e.g. the very first Vercel deploy, before the Neon database is attached: build the site, set up the DB on the next deploy.
    console.warn("No DATABASE_URL yet: skipping database setup. Attach the database and redeploy.");
    return;
  }
  await runMigrations(url);
  await setupBase();
  const email = process.env.BOOTSTRAP_DIRECTOR_EMAIL, pw = process.env.BOOTSTRAP_DIRECTOR_PASSWORD;
  if (email && pw) {
    const id = await createFirstDirector(email, process.env.BOOTSTRAP_DIRECTOR_NAME || "Director", pw);
    console.log(id ? `Director account created for ${email}. They must change the password at first sign-in. Remove BOOTSTRAP_DIRECTOR_PASSWORD from the environment now.` : "Users already exist — no Director created.");
  } else console.log("BOOTSTRAP_DIRECTOR_EMAIL / BOOTSTRAP_DIRECTOR_PASSWORD not set — skipped creating the first Director.");
  console.log("Setup complete.");
  await closeDb();
})().catch(async (e) => {
  const msg = e instanceof Error ? e.message : String(e);
  let hint = "";
  if (/Password must/.test(msg)) hint = "Fix: in Vercel → Settings → Environment Variables, set BOOTSTRAP_DIRECTOR_PASSWORD to at least 10 characters with letters AND numbers, then redeploy.";
  else if (/ENOTFOUND|ECONNREFUSED|password authentication|does not exist|SSL|certificate|timeout/i.test(msg)) hint = "Fix: the database connection failed. Check the Neon database is connected to this project (Storage tab) and that DATABASE_URL exists in Environment Variables, then redeploy.";
  console.error("\n================ ISSS SETUP FAILED ================");
  console.error("Reason: " + msg);
  if (hint) console.error(hint);
  console.error("===================================================\n");
  console.error(e);
  await closeDb();
  process.exit(1);
});
