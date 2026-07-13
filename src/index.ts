import { loadLocalEnv } from "./env.js";
import { createServer } from "./server.js";
import { productionConfig, missingProductionConfig } from "./config.js";
import { createProductionContext } from "./postgres.js";

loadLocalEnv();

const port = Number(process.env.PORT ?? 8080);
const config = productionConfig();
const missing = missingProductionConfig(config);
const useDemoData = process.env.USE_DEMO_DATA === "true";

if (process.env.NODE_ENV === "production" && missing.length > 0) {
  console.warn(`HansUp production config missing: ${missing.join(", ")}`);
}

const { store, persist } = await createProductionContext(config.databaseUrl, useDemoData);

createServer(store, config, persist).listen(port, () => {
  console.log(`HansUp API listening on http://localhost:${port}`);
  console.log(`HansUp demo data: ${useDemoData ? "on" : "off"}`);
});
