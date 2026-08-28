type PublicOriginEnvironment = Readonly<{
  MRAP_CANONICAL_ORIGIN?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
}>;

export function resolvePublicOrigin(environment: PublicOriginEnvironment = process.env as PublicOriginEnvironment) {
  const configured = environment.MRAP_CANONICAL_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;

  const vercelHost = environment.VERCEL_PROJECT_PRODUCTION_URL?.trim() || environment.VERCEL_URL?.trim();
  if (vercelHost) return new URL(`https://${vercelHost}`).origin;

  return "http://127.0.0.1:3100";
}
