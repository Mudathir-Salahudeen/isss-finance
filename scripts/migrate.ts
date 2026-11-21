import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function runMigrations(url: string) {
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations(process.env.DATABASE_URL!).then(() => console.log("Migrations applied.")).catch((e) => { console.error(e); process.exit(1); });
}
