import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL as string);
async function run() {
  await sql("DROP SCHEMA public CASCADE");
  await sql("CREATE SCHEMA public");
  console.log("Schema reset complete");
}
run().catch((e) => console.error(e));
