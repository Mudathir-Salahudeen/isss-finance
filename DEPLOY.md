# Putting ISSS Finance online — Vercel + Neon (PostgreSQL)

Everything (records, audit log, uploaded evidence, logo) lives in the PostgreSQL database, so the app runs on
serverless hosting with no disk. `vercel.json` sets the build command to
`npm run db:bootstrap && next build`: every deploy applies database migrations first, and on the very first
deploy it creates the default roles, the ISSS name and logo, and the first Director account.

> **Plan note:** Vercel's free Hobby plan is for personal, non-commercial use. Use it to set up and test.
> For day-to-day use by the school, Vercel may expect the Pro plan.

## Steps

1. Sign in at **vercel.com** with your GitHub account.
2. **Add New → Project** → import `Mudathir-Salahudeen/isss-finance` → **don't deploy yet**. First expand
   *Environment Variables* and add:
   | Name | Value |
   |---|---|
   | `BOOTSTRAP_DIRECTOR_EMAIL` | the Director's email |
   | `BOOTSTRAP_DIRECTOR_PASSWORD` | a strong **temporary** password (10+ characters, letters and numbers) |
   | `BOOTSTRAP_DIRECTOR_NAME` | the Director's full name |
   | `SCHOOL_NAME` | `IBN Salahudeen Science School (ISSS)` |
3. Click **Deploy**. The first build fails because there is no database yet. That's expected.
4. In the project: **Storage → Create Database → Neon (Postgres)**, choose the free plan and region
   **Europe (Frankfurt)**, then connect it to the project for all environments. This adds `DATABASE_URL` automatically.
5. **Deployments → ⋯ → Redeploy.** The build now sets up the database and the site goes live at
   `https://<project>.vercel.app`.
6. Open the site, sign in as the Director, and set a new password when asked. Then, in Vercel, **delete
   `BOOTSTRAP_DIRECTOR_PASSWORD`** from the Environment Variables.
7. In the app: School settings (address, phone, email) → Classes & sessions → Bank & cash accounts → Users →
   Bulk import students.

Optional: **Settings → Domains** to use e.g. `finance.isss.edu.ng`.

## Limits on this setup

* Uploads (evidence, imports) are limited to **4 MB per file** (Vercel's request size limit).
* Backups: Neon keeps point-in-time history. For an off-site copy run `scripts/backup.sh` (needs `pg_dump`
  and the database's connection string). One dump file contains everything, including uploaded evidence.
