// Zero-dependency static file server for local development.
// Usage: node serve.mjs [--watch]   (PORT env var overrides the default 8080)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    let filePath = normalize(join(ROOT, urlPath));

    // Block path traversal and the node_modules folder.
    if (!filePath.startsWith(ROOT) || filePath.startsWith(join(ROOT, "node_modules"))) {
        res.writeHead(403).end("Forbidden");
        return;
    }

    try {
        if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
        const body = await readFile(filePath);
        res.writeHead(200, {
            "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
            "Cache-Control": "no-store",
        });
        res.end(body);
    } catch {
        res.writeHead(404).end("Not found");
    }
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
});

if (process.argv.includes("--watch")) {
    const tsc = spawn(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"], {
        cwd: ROOT,
        stdio: "inherit",
    });
    const shutdown = () => {
        tsc.kill();
        server.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
