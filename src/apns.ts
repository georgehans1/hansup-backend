import http2 from "node:http2";
import { createSign } from "node:crypto";
import { ProductionConfig } from "./config.js";

export interface PushPayload {
  title: string;
  body: string;
  category?: string;
  data?: Record<string, unknown>;
}

export interface PushResult {
  ok: boolean;
  status?: number;
  reason?: string;
}

export async function sendApnsPush(config: ProductionConfig, deviceToken: string, payload: PushPayload): Promise<PushResult> {
  if (!config.apnsTeamId || !config.apnsKeyId || !config.apnsBundleId || !config.apnsPrivateKey) {
    return { ok: false, reason: "APNs is not configured" };
  }

  const host = config.apnsSandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const client = http2.connect(host);
  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      category: payload.category
    },
    data: payload.data ?? {}
  });

  const headers = {
    ":method": "POST",
    ":path": `/3/device/${deviceToken}`,
    authorization: `bearer ${providerToken(config)}`,
    "apns-topic": config.apnsBundleId,
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  };

  return new Promise((resolve) => {
    const request = client.request(headers);
    let responseBody = "";
    let status = 0;
    request.setEncoding("utf8");
    request.on("response", (headers: Record<string, unknown>) => {
      status = Number(headers[":status"] ?? 0);
    });
    request.on("data", (chunk: string) => {
      responseBody += chunk;
    });
    request.on("end", () => {
      client.close();
      resolve({ ok: status >= 200 && status < 300, status, reason: responseBody || undefined });
    });
    request.on("error", (error: Error) => {
      client.close();
      resolve({ ok: false, reason: error.message });
    });
    request.end(body);
  });
}

export function providerToken(config: ProductionConfig, issuedAt = Math.floor(Date.now() / 1000)): string {
  if (!config.apnsTeamId || !config.apnsKeyId || !config.apnsPrivateKey) {
    throw new Error("Missing APNs credentials");
  }

  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.apnsKeyId }));
  const claims = base64Url(JSON.stringify({ iss: config.apnsTeamId, iat: issuedAt }));
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  const signature = signer.sign(config.apnsPrivateKey).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
