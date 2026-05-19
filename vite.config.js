import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { aiHeaders, callAi, loadLocalEnv, readRequestBody } from "./ai-proxy.mjs";

loadLocalEnv();

function aiProxyPlugin() {
  return {
    name: "ai-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url || "").split("?")[0];
        if (pathname !== "/api/ai") return next();

        if (req.method === "OPTIONS") {
          res.writeHead(204, aiHeaders);
          res.end();
          return;
        }

        if (req.method !== "POST") {
          res.writeHead(405, { ...aiHeaders, Allow: "POST, OPTIONS" });
          res.end(JSON.stringify({ error: { message: "Metodo no permitido" } }));
          return;
        }

        try {
          const body = await readRequestBody(req);
          const payload = JSON.parse(body || "{}");
          const data = await callAi(payload);
          res.writeHead(200, aiHeaders);
          res.end(JSON.stringify(data));
        } catch (error) {
          res.writeHead(502, aiHeaders);
          res.end(JSON.stringify({ error: { message: error.message || "IA no disponible" } }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), aiProxyPlugin()],
  server: {
    host: "127.0.0.1",
    cors: true,
  },
});
