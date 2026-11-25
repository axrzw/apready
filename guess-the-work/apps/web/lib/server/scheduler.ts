import { getRepo } from "./repo";
import { runJob } from "./admin";

/** Weekly job inside the app (ENABLE_SCHEDULER=1): checks every hour, runs when the last run is a week old. */
export function startScheduler() {
  if (process.env.ENABLE_SCHEDULER !== "1") return;
  const check = async () => {
    try {
      const last = (await getRepo().getSetting<number>("lastWeekly")) ?? 0;
      if (Date.now() - last > 7 * 86_400_000) {
        await getRepo().setSetting("lastWeekly", Date.now());
        runJob("weekly");
      }
    } catch (e) {
      console.error("scheduler", e);
    }
  };
  setTimeout(check, 60_000);
  setInterval(check, 3600_000).unref?.();
}
