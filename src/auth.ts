import { createHmac, randomBytes } from "node:crypto";
import { ProductionConfig } from "./config.js";

export interface VerifiedIdentity {
  provider: "google";
  subject: string;
  email?: string;
  displayName?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function verifyGoogleIdentity(input: {
  idToken: string;
  email?: string;
  displayName?: string;
  config: ProductionConfig;
}): Promise<VerifiedIdentity> {
  if (!input.config.googleClientId) {
    return demoIdentity("google", input.idToken, input.email, input.displayName);
  }

  const response = await fetchJson<GoogleTokenInfo>(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(input.idToken)}`
  );
  if (response.aud !== input.config.googleClientId) {
    throw new Error("Google token audience mismatch");
  }
  if (response.iss !== "https://accounts.google.com" && response.iss !== "accounts.google.com") {
    throw new Error("Google token issuer mismatch");
  }
  if (Number(response.exp) * 1000 < Date.now()) {
    throw new Error("Google token expired");
  }

  return {
    provider: "google",
    subject: response.sub,
    email: response.email ?? input.email,
    displayName: input.displayName
  };
}

export async function exchangeGoogleAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  config: ProductionConfig;
}): Promise<VerifiedIdentity> {
  if (!input.config.googleClientId) {
    throw new Error("GOOGLE_CLIENT_ID is required for Google authorization code exchange");
  }

  const token = await postForm<GoogleTokenResponse>("https://oauth2.googleapis.com/token", {
    client_id: input.config.googleClientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri
  });

  if (!token.id_token) {
    throw new Error("Google token response did not include an ID token");
  }

  return verifyGoogleIdentity({ idToken: token.id_token, config: input.config });
}

export function issueDemoTokens(userId: string, secret = "demo-secret"): TokenPair {
  const nonce = randomBytes(12).toString("hex");
  return {
    accessToken: signToken({ sub: userId, typ: "access", nonce, exp: Math.floor(Date.now() / 1000) + 900 }, secret),
    refreshToken: signToken({ sub: userId, typ: "refresh", nonce, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, secret)
  };
}

function demoIdentity(provider: "google", token: string, email?: string, displayName?: string): VerifiedIdentity {
  const fallback = "ama@example.com";
  return {
    provider,
    subject: `${provider}_${stableHash(token || email || fallback)}`,
    email: email ?? fallback,
    displayName: displayName ?? "Ama Mensah"
  };
}

function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function decodeJwtPayload<T>(token: string): T {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Invalid identity token");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Identity provider request failed with ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function postForm<T>(url: string, values: Record<string, string>): Promise<T> {
  const body = new URLSearchParams(values);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    throw new Error(`Identity provider request failed with ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function stableHash(value: string): string {
  return createHmac("sha256", "hansup").update(value).digest("hex").slice(0, 16);
}

interface GoogleTokenInfo {
  aud: string;
  iss: string;
  exp: string;
  sub: string;
  email?: string;
}

interface GoogleTokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}
