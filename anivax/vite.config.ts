import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    // React Router re-compiles route modules when the manifest updates; without this,
    // Vite can throw "new version of the pre-bundle" (throwOutdatedRequest) during dev.
    ignoreOutdatedRequests: true,
  },
  server: {
    warmup: {
      clientFiles: [
        "./app/routes/queue-new-consultation.tsx",
        "./app/routes/queue-records.tsx",
        "./app/routes/queue-records-history.tsx",
        "./app/routes/queue-add-user.tsx",
      ],
    },
  },
});
