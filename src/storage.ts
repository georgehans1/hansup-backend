import { ProductionConfig } from "./config.js";
import { info, warn } from "./logger.js";

export async function storeAvatar(config: ProductionConfig, userId: string, dataURL: string): Promise<string> {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !config.supabaseAvatarBucket) {
    throw new Error("Avatar storage is not configured");
  }
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(dataURL);
  if (!match) throw new Error("Profile photo must be a JPEG, PNG, or WebP image");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 3_000_000) throw new Error("Profile photo must be smaller than 3 MB");
  const extension = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/avatar.${extension}`;
  const endpoint = `${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(config.supabaseAvatarBucket)}/${path}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      apikey: config.supabaseServiceRoleKey,
      "content-type": match[1],
      "x-upsert": "true"
    },
    body: bytes
  });
  if (!response.ok) throw new Error(`Profile photo upload failed (${response.status})`);
  await removePaths(config, ["jpg", "png", "webp"].filter((item) => item !== extension).map((item) => `${userId}/avatar.${item}`), false);
  info("avatar_uploaded", { userId, bucket: config.supabaseAvatarBucket, bytes: bytes.length });
  return `${config.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(config.supabaseAvatarBucket)}/${path}?v=${Date.now()}`;
}

export async function deleteAvatar(config: ProductionConfig, userId: string): Promise<void> {
  requireStorageConfig(config);
  await removePaths(config, ["jpg", "png", "webp"].map((extension) => `${userId}/avatar.${extension}`), true);
  info("avatar_deleted", { userId, bucket: config.supabaseAvatarBucket });
}

export async function verifyAvatarBucket(config: ProductionConfig): Promise<void> {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !config.supabaseAvatarBucket) {
    warn("avatar_bucket_not_configured");
    return;
  }
  try {
    const response = await fetch(`${config.supabaseUrl}/storage/v1/bucket/${encodeURIComponent(config.supabaseAvatarBucket)}`, { headers: storageHeaders(config) });
    if (!response.ok) throw new Error(`Bucket lookup failed (${response.status})`);
    const bucket = await response.json();
    if (bucket.public !== true) warn("avatar_bucket_not_public", { bucket: config.supabaseAvatarBucket });
    else info("avatar_bucket_ready", { bucket: config.supabaseAvatarBucket, public: true });
  } catch (failure) {
    warn("avatar_bucket_check_failed", { error: failure instanceof Error ? failure.message : String(failure) });
  }
}

function requireStorageConfig(config: ProductionConfig) {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !config.supabaseAvatarBucket) throw new Error("Avatar storage is not configured");
}

function storageHeaders(config: ProductionConfig): Record<string, string> {
  return { authorization: `Bearer ${config.supabaseServiceRoleKey}`, apikey: config.supabaseServiceRoleKey ?? "" };
}

async function removePaths(config: ProductionConfig, prefixes: string[], required: boolean) {
  if (prefixes.length === 0) return;
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(config.supabaseAvatarBucket ?? "")}`, {
    method: "DELETE",
    headers: { ...storageHeaders(config), "content-type": "application/json" },
    body: JSON.stringify({ prefixes })
  });
  if (!response.ok && required) throw new Error(`Profile photo deletion failed (${response.status})`);
}
