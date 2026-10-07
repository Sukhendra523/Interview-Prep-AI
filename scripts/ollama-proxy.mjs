import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// Automatically read .env.local if present
try {
    const envPath = path.resolve(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, "utf-8").split("\n");
        for (const line of lines) {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match && !process.env[match[1]]) {
                process.env[match[1]] = match[2]?.trim().replace(/^['"]|['"]$/g, "") || "";
            }
        }
    }
} catch { }

const PROXY_PORT = Number(process.env.PROXY_PORT);
const OLLAMA_TARGET = process.env.OLLAMA_LOCAL_URL;
const SECRET_TOKEN = process.env.OLLAMA_PROXY_SECRET;

const server = http.createServer((req, res) => {
    // 1. Check Authentication Header
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${SECRET_TOKEN}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing token." }));
    }

    // 2. Forward authorized request to local Ollama
    const proxyReq = http.request(
        `${OLLAMA_TARGET}${req.url}`,
        {
            method: req.method,
            headers: { ...req.headers, host: 'localhost:11434' },
        },
        (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        }
    );

    proxyReq.on("error", (err) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cannot connect to local Ollama.", detail: err.message }));
    });

    req.pipe(proxyReq);
});

server.listen(PROXY_PORT, () => {
    console.log(`🔐 Ollama Auth Proxy running on http://localhost:${PROXY_PORT}`);
    console.log(`🔑 Protected with secret Bearer token.`);
});
