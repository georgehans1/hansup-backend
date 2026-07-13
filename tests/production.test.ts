import assert from "node:assert/strict";
import test from "node:test";
import { verifyGoogleIdentity } from "../src/auth.js";
import { missingProductionConfig, productionConfig } from "../src/config.js";
import { providerToken } from "../src/apns.js";

test("reports missing production configuration", () => {
  const missing = missingProductionConfig(productionConfig({}));
  assert.equal(missing.includes("DATABASE_URL"), true);
  assert.equal(missing.includes("GOOGLE_CLIENT_ID"), true);
  assert.equal(missing.includes("APNS_PRIVATE_KEY"), false);
});

test("uses demo identity verification when provider client ids are not configured", async () => {
  const google = await verifyGoogleIdentity({ idToken: "demo", email: "hans@example.com", displayName: "Hans", config: productionConfig({}) });

  assert.equal(google.provider, "google");
  assert.equal(google.email, "hans@example.com");
});

test("creates APNs provider tokens when credentials are configured", () => {
  const token = providerToken({
    apnsTeamId: "TEAMID1234",
    apnsKeyId: "KEYID1234",
    apnsBundleId: "com.hansup.app",
    apnsPrivateKey: testPrivateKey,
    apnsSandbox: true
  }, 1_800_000_000);

  assert.equal(token.split(".").length, 3);
});

const testPrivateKey = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgt0zb0ae2gCeB/QHL
UIzjgmn2NsMPymLeylRswrB4ktqhRANCAASUjRz98ZZvXz3CvedKC/oLMBtCwAd0
JQ1g46w7YatSCLia39ibowi6JWJa3E3qyVgYhAI+aonzrR3GcJvqvKgy
-----END PRIVATE KEY-----`;
