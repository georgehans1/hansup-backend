export interface ProductionConfig {
  databaseUrl?: string;
  googleClientId?: string;
  jwtSecret?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseAvatarBucket?: string;
  apnsTeamId?: string;
  apnsKeyId?: string;
  apnsBundleId?: string;
  apnsPrivateKey?: string;
  apnsSandbox: boolean;
}

export function productionConfig(env: Record<string, string | undefined> = process.env): ProductionConfig {
  return {
    databaseUrl: env.DATABASE_URL,
    googleClientId: env.GOOGLE_CLIENT_ID,
    jwtSecret: env.JWT_SECRET,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseAvatarBucket: env.SUPABASE_AVATAR_BUCKET ?? "avatars",
    apnsTeamId: env.APNS_TEAM_ID,
    apnsKeyId: env.APNS_KEY_ID,
    apnsBundleId: env.APNS_BUNDLE_ID,
    apnsPrivateKey: env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    apnsSandbox: env.APNS_SANDBOX !== "false"
  };
}

export function missingProductionConfig(config: ProductionConfig): string[] {
  const required: Array<[keyof ProductionConfig, string]> = [
    ["databaseUrl", "DATABASE_URL"],
    ["googleClientId", "GOOGLE_CLIENT_ID"],
    ["jwtSecret", "JWT_SECRET"]
  ];

  return required.filter(([key]) => !config[key]).map(([, name]) => name);
}
