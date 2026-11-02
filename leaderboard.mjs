// Zero-dependency shared leaderboard: GET/POST <anything>/api/leaderboard, stored in one JSON file.
// Standalone: node leaderboard.mjs   (LEADERBOARD_PORT, default 8787; LEADERBOARD_FILE, default
// ./leaderboard.json). serve.mjs also mounts it for local development.
import { createServer } from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const FILE = process.env.LEADERBOARD_FILE ?? join(ROOT, "leaderboard.json");
const PORT = Number(process.env.LEADERBOARD_PORT) || 8787;
// Entries kept in the file, and shown to players.
const MAX_ENTRIES = 100;
const TOP_SHOWN = 10;
// One submission per address per this many ms, to keep spam down.
const SUBMIT_COOLDOWN_MS = 5000;
const MAX_BODY_BYTES = 1024;

let entries = null;
let saving = Promise.resolve();
const lastSubmitAt = new Map();

async function load() {
    if (entries === null) {
        try {
            entries = JSON.parse(await readFile(FILE, "utf8"));
        } catch {
            entries = [];
        }
    }
    return entries;
}

// Writes to a temp file then renames, so a crash mid-write can't corrupt the board.
function save() {
    const data = JSON.stringify(entries);
    saving = saving.then(async () => {
        await writeFile(`${FILE}.tmp`, data);
        await rename(`${FILE}.tmp`, FILE);
    }).catch((err) => console.error("leaderboard save failed:", err));
    return saving;
}

// Longest survival first, then most kills.
const byScore = (a, b) => b.time - a.time || b.kills - a.kills;

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Returns a clean entry, or null if the submission is malformed.
function parseEntry(body) {
    let data;
    try {
        data = JSON.parse(body);
    } catch {
        return null;
    }
    const time = Number(data?.time);
    if (!(time >= 0 && time <= 86400) || !isInt(data.level, 1, 10000) || !isInt(data.kills, 0, 1e7)) {
        return null;
    }
    const name = String(data.name ?? "").replace(/[^\p{L}\p{N} _.'-]/gu, "").trim().slice(0, 16) || "Anonymous";
    return { name, time: Math.round(time * 10) / 10, level: data.level, kills: data.kills, date: new Date().toISOString().slice(0, 10) };
}

function send(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
}

// Handles the request if it is for the leaderboard API. Returns false otherwise.
export async function handleLeaderboard(req, res) {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!path.endsWith("/api/leaderboard")) {
        return false;
    }
    const board = await load();
    if (req.method === "GET") {
        send(res, 200, { entries: board.slice(0, TOP_SHOWN), rank: null });
        return true;
    }
    if (req.method !== "POST") {
        send(res, 405, { error: "method not allowed" });
        return true;
    }

    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    const now = Date.now();
    if (now - (lastSubmitAt.get(ip) ?? 0) < SUBMIT_COOLDOWN_MS) {
        send(res, 429, { error: "too many submissions" });
        return true;
    }
    let body = "";
    for await (const chunk of req) {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
            send(res, 413, { error: "too large" });
            return true;
        }
    }
    const entry = parseEntry(body);
    if (!entry) {
        send(res, 400, { error: "invalid entry" });
        return true;
    }
    if (lastSubmitAt.size > 10000) {
        lastSubmitAt.clear();
    }
    lastSubmitAt.set(ip, now);

    board.push(entry);
    board.sort(byScore);
    board.length = Math.min(board.length, MAX_ENTRIES);
    const index = board.indexOf(entry);
    await save();
    send(res, 200, { entries: board.slice(0, TOP_SHOWN), rank: index >= 0 ? index + 1 : null });
    return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    createServer(async (req, res) => {
        if (!(await handleLeaderboard(req, res))) {
            send(res, 404, { error: "not found" });
        }
    }).listen(PORT, "127.0.0.1", () => console.log(`Leaderboard API on http://127.0.0.1:${PORT}, file ${FILE}`));
}
