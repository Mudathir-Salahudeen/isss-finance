import "dotenv/config";
export default async function () {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
