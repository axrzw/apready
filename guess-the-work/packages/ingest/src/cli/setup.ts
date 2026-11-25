/**
 * Runs on every build (Vercel) and locally: migrations, then the library snapshot (skipped when unchanged).
 * Safe to repeat. Without DATABASE_URL on Vercel it does nothing (the site shows a setup message).
 */
import { openRepo } from "../config";
import { importSnapshot } from "./snapshot";

async function main() {
  if (process.env.VERCEL && !process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.log("setup: no DATABASE_URL on Vercel, skipping (add Neon from the Marketplace)");
    return;
  }
  const o = await openRepo();
  console.log(`setup: migrations done (${o.kind})`);
  console.log(`setup: ${await importSnapshot(o.repo)}`);
  await o.close();
}

main().catch((e) => {
  console.error("setup failed:", e);
  // on Vercel a database problem must not block the deploy: the site shows what is missing instead
  process.exit(process.env.VERCEL ? 0 : 1);
});
