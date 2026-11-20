export interface Env {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  DATABASE_PUBLIC_URL: string;
  S3_BUCKET: string;
  S3_REGION: string;
  SES_FROM: string;
  /** Region of the SES endpoint. Falls back to S3_REGION. */
  SES_REGION?: string;
  CLAIM_CODE_SECRET: string;
  MANAGE_TOKEN_SECRET: string;
  DEVICE_HASH_SALT: string;
  FIREBASE_PROJECT_ID: string;
  JOBS_ENABLED: boolean;
  /** Number of reverse-proxy hops to trust for req.ip. 0 means off. */
  TRUST_PROXY: number;
  /** Public base URL for media (bucket or CDN). When set, views carry photo.url. */
  MEDIA_BASE_URL?: string;
}

const REQUIRED = [
  'DATABASE_URL',
  'DATABASE_PUBLIC_URL',
  'S3_BUCKET',
  'S3_REGION',
  'SES_FROM',
  'CLAIM_CODE_SECRET',
  'MANAGE_TOKEN_SECRET',
  'DEVICE_HASH_SALT',
  'FIREBASE_PROJECT_ID',
] as const;

const MIN_SECRET_LENGTH = 32;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const missing = REQUIRED.filter((key) => !source[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const problems: string[] = [];
  for (const key of ['CLAIM_CODE_SECRET', 'MANAGE_TOKEN_SECRET'] as const) {
    if (source[key]!.length < MIN_SECRET_LENGTH) {
      problems.push(`${key} must be at least ${MIN_SECRET_LENGTH} characters`);
    }
  }

  const port = source.PORT === undefined || source.PORT === '' ? 3000 : Number(source.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    problems.push('PORT must be an integer between 0 and 65535');
  }

  const trustRaw = source.TRUST_PROXY;
  const trustProxy = trustRaw === undefined || trustRaw === '' ? 0 : Number(trustRaw);
  if (!Number.isInteger(trustProxy) || trustProxy < 0) {
    problems.push('TRUST_PROXY must be a non-negative integer hop count');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid environment variables: ${problems.join('; ')}`);
  }

  return {
    NODE_ENV: source.NODE_ENV || 'development',
    PORT: port,
    DATABASE_URL: source.DATABASE_URL!,
    DATABASE_PUBLIC_URL: source.DATABASE_PUBLIC_URL!,
    S3_BUCKET: source.S3_BUCKET!,
    S3_REGION: source.S3_REGION!,
    SES_FROM: source.SES_FROM!,
    ...(source.SES_REGION ? { SES_REGION: source.SES_REGION } : {}),
    CLAIM_CODE_SECRET: source.CLAIM_CODE_SECRET!,
    MANAGE_TOKEN_SECRET: source.MANAGE_TOKEN_SECRET!,
    DEVICE_HASH_SALT: source.DEVICE_HASH_SALT!,
    FIREBASE_PROJECT_ID: source.FIREBASE_PROJECT_ID!,
    TRUST_PROXY: trustProxy,
    ...(source.MEDIA_BASE_URL ? { MEDIA_BASE_URL: source.MEDIA_BASE_URL } : {}),
    JOBS_ENABLED: source.JOBS_ENABLED === undefined ? true : source.JOBS_ENABLED.toLowerCase() !== 'false',
  };
}
