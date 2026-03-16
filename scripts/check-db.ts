import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL as string);

async function run() {
  const families = await sql("SELECT * FROM league_families");
  console.log("league_families:", JSON.stringify(families, null, 2));

  const leagues = await sql("SELECT id, name, season, previous_league_id FROM leagues ORDER BY season");
  console.log("\nleagues:", JSON.stringify(leagues, null, 2));
}
run().catch(console.error);
