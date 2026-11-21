import "dotenv/config";
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for tests");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // tests never touch the real database
process.env.UPLOAD_DIR = "./storage/test-uploads";
