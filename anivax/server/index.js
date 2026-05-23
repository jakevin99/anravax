import "dotenv/config";
import { createApp } from "./app.js";
import { pruneExpiredRefreshTokens } from "./services/tokens.js";
import {
  tickDoseDueTomorrowJob,
  tickDoseOverdueJob,
  tickQueueNearJob,
} from "./services/notifications.js";
import { purgeExpiredRecyclePatients } from "./services/patientRecycle.js";

const port = Number(process.env.API_PORT ?? 4000);

const app = await createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}/api/v1`);
});

/* -------------------------------------------------------------------------- */
/*                            In-process cron jobs                            */
/* -------------------------------------------------------------------------- */

const FEATURE_PUSH = (process.env.FEATURE_PUSH_NOTIFICATIONS ?? "off").toLowerCase() === "on";

const QUEUE_NEAR_INTERVAL_MS = 60_000;
const DAILY_INTERVAL_MS = 60_000;

let lastDoseDueRunHour = -1;
let lastDoseOverdueRunHour = -1;
let lastPruneDay = -1;

async function runQueueNear() {
  if (!FEATURE_PUSH) return;
  try {
    await tickQueueNearJob();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[anivax/cron] tickQueueNearJob: ${e?.message ?? e}`);
  }
}

async function runDailyJobs() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDate();

  if (FEATURE_PUSH && hour === 18 && lastDoseDueRunHour !== 18) {
    lastDoseDueRunHour = 18;
    try {
      await tickDoseDueTomorrowJob();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[anivax/cron] tickDoseDueTomorrowJob: ${e?.message ?? e}`);
    }
  }
  if (hour !== 18) lastDoseDueRunHour = -1;

  if (FEATURE_PUSH && hour === 9 && lastDoseOverdueRunHour !== 9) {
    lastDoseOverdueRunHour = 9;
    try {
      await tickDoseOverdueJob();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[anivax/cron] tickDoseOverdueJob: ${e?.message ?? e}`);
    }
  }
  if (hour !== 9) lastDoseOverdueRunHour = -1;

  if (lastPruneDay !== day) {
    lastPruneDay = day;
    try {
      await pruneExpiredRefreshTokens();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[anivax/cron] pruneExpiredRefreshTokens: ${e?.message ?? e}`);
    }
    try {
      const purged = await purgeExpiredRecyclePatients();
      if (purged > 0) {
        // eslint-disable-next-line no-console
        console.log(`[anivax/cron] Recycle bin: purged ${purged} expired patient(s).`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[anivax/cron] purgeExpiredRecyclePatients: ${e?.message ?? e}`);
    }
  }
}

setInterval(runQueueNear, QUEUE_NEAR_INTERVAL_MS);
setInterval(runDailyJobs, DAILY_INTERVAL_MS);

// One-shot at boot so the prune happens immediately on first start.
void runDailyJobs();
