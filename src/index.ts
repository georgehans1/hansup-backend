import { loadLocalEnv } from "./env.js";
import { createServer } from "./server.js";
import { productionConfig, missingProductionConfig } from "./config.js";
import { createProductionContext } from "./postgres.js";
import { addDailyGroupChallengeUpdates, refreshAllChallenges } from "./store.js";
import { error, info, warn } from "./logger.js";
import { verifyAvatarBucket } from "./storage.js";

loadLocalEnv();

const port = Number(process.env.PORT ?? 8080);
const config = productionConfig();
const missing = missingProductionConfig(config);
const useDemoData = process.env.USE_DEMO_DATA === "true";
await verifyAvatarBucket(config);

if (process.env.NODE_ENV === "production" && missing.length > 0) {
  warn("production_config_missing", { keys: missing });
}

const { store, persist } = await createProductionContext(config.databaseUrl, useDemoData);

createServer(store, config, persist).listen(port, () => {
  info("server_started", { port, environment: process.env.NODE_ENV ?? "development", demoData: useDemoData });
});

setInterval(async () => {
  try {
    const changed = refreshAllChallenges(store);
    const groupUpdates = addDailyGroupChallengeUpdates(store);
    const affected = [...new Set([...changed, ...groupUpdates])];
    for (const challengeId of affected) await persist({ kind: "challenge", challengeId, includeSharedMessages: groupUpdates.includes(challengeId) });
    if (changed.length > 0) info("challenges_finalized", { count: changed.length });
    if (groupUpdates.length > 0) info("group_challenge_updates_posted", { count: groupUpdates.length });
  } catch (failure) {
    error("challenge_finalization_failed", failure);
  }
}, 60_000).unref();
