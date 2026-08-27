import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: false,
    coverage: {
      // Bunlar Supabase Auth/PostgREST/PostGIS sınır adapterleridir. Mock sözleşme
      // testleri ayrıca çalışır; satır kapsamı yerine uzak contract + smoke kabulüne tabidir.
      exclude: [
        "src/lib/supabase-repository.ts",
        "src/lib/supabase/**",
        "src/server/game/supabase-authoritative-store.ts",
      ],
    },
  },
});
