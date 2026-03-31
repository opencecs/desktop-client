var _a;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
var apiTarget = (_a = process.env.VITE_API_TARGET) !== null && _a !== void 0 ? _a : "http://127.0.0.1:8080";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    server: {
        host: "0.0.0.0",
        port: 5173,
        proxy: {
            "/api": {
                target: apiTarget,
                changeOrigin: true,
                secure: false,
                ws: true,
            },
            "/healthz": {
                target: apiTarget,
                changeOrigin: true,
                secure: false,
            },
        },
    },
});
