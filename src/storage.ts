import { ProductionConfig } from "./config.js";
import { info } from "./logger.js";

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
  info("avatar_uploaded", { userId, bucket: config.supabaseAvatarBucket, bytes: bytes.length });
  return `${config.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(config.supabaseAvatarBucket)}/${path}?v=${Date.now()}`;
}
