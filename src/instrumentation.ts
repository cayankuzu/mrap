export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionEnvironment } = await import("@/server/production-environment");
  assertProductionEnvironment();
}
