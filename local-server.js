const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 1. Load Environment Variables from .env
if (typeof process.loadEnvFile === 'function') {
    try {
        process.loadEnvFile(path.join(__dirname, '.env'));
    } catch (e) {
        // .env file might not exist in production if environment variables are injected via host
    }
} else {
    // Fallback simple parser for older Node versions
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
        for (const line of lines) {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = (match[2] || '').trim();
                if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
                if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
                if (!process.env[key]) process.env[key] = value;
            }
        }
    }
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dsg';
const SESSION_SECRET = process.env.SESSION_SECRET || 'impactathon_secret_fallback_key';

// Local shared state file for persistence
const STATE_FILE = path.join(__dirname, '.timer-state.json');
let localTimerState = {
    isRunning: false,
    duration: 6 * 60 * 60 * 1000,
    pausedRemainingTime: 6 * 60 * 60 * 1000,
    endTime: 0,
    updatedAt: Date.now()
};

if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        if (saved && typeof saved.duration === 'number') {
            localTimerState = saved;
        }
    } catch (e) {}
}

function verifySessionToken(token, secret) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payload, sig] = parts;
    const tokenTime = parseInt(payload, 10);
    if (isNaN(tokenTime) || Math.abs(Date.now() - tokenTime) > 48 * 60 * 60 * 1000) return false;
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (sig.length !== expectedSig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
}

// MIME types for static assets
const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm'
};

const server = http.createServer((req, res) => {
    // Security & CORS headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    // API Endpoint: POST /api/verify-admin
    if (req.method === 'POST' && req.url === '/api/verify-admin') {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 1e6) req.destroy();
        });

        req.on('end', () => {
            try {
                const { password } = JSON.parse(body || '{}');

                if (typeof password !== 'string') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Invalid payload' }));
                }

                // Constant-time hash comparison
                const userHash = crypto.createHash('sha256').update(String(password)).digest();
                const actualHash = crypto.createHash('sha256').update(String(ADMIN_PASSWORD)).digest();
                const isMatch = crypto.timingSafeEqual(userHash, actualHash);

                if (isMatch) {
                    const payload = `${Date.now()}`;
                    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
                    const token = `${payload}.${signature}`;

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, token }));
                } else {
                    setTimeout(() => {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Incorrect password' }));
                    }, 250);
                }
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Malformed JSON' }));
            }
        });
        return;
    }

    // API Endpoint: GET /api/timer
    if (req.method === 'GET' && req.url.startsWith('/api/timer')) {
        const now = Date.now();
        if (localTimerState.isRunning && localTimerState.endTime > 0 && now >= localTimerState.endTime) {
            localTimerState.isRunning = false;
            localTimerState.pausedRemainingTime = 0;
            localTimerState.endTime = 0;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            state: localTimerState,
            serverTime: now
        }));
    }

    // API Endpoint: POST /api/timer
    if (req.method === 'POST' && req.url.startsWith('/api/timer')) {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 1e6) req.destroy();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body || '{}');
                const authHeader = req.headers['authorization'] || '';
                const token = authHeader.replace(/^Bearer\s+/i, '').trim() || data.token || '';

                let isAuthorized = false;
                if (data.adminPassword) {
                    const userHash = crypto.createHash('sha256').update(String(data.adminPassword)).digest();
                    const actualHash = crypto.createHash('sha256').update(String(ADMIN_PASSWORD)).digest();
                    isAuthorized = crypto.timingSafeEqual(userHash, actualHash);
                } else if (token) {
                    isAuthorized = verifySessionToken(token, SESSION_SECRET);
                }

                if (!isAuthorized) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                }

                const now = Date.now();
                const duration = Math.max(1000, Number(data.duration) || (6 * 60 * 60 * 1000));
                const isRunning = Boolean(data.isRunning);
                let pausedRemainingTime = Number(data.pausedRemainingTime);
                if (isNaN(pausedRemainingTime)) pausedRemainingTime = duration;

                let endTime = 0;
                if (isRunning) {
                    endTime = now + pausedRemainingTime;
                } else {
                    endTime = 0;
                }

                localTimerState = {
                    isRunning,
                    duration,
                    pausedRemainingTime,
                    endTime,
                    updatedAt: now
                };

                try {
                    fs.writeFileSync(STATE_FILE, JSON.stringify(localTimerState, null, 2));
                } catch(e) {}

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    success: true,
                    state: localTimerState,
                    serverTime: now
                }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Malformed JSON' }));
            }
        });
        return;
    }

    // Static File Serving
    let safeUrl = req.url.split('?')[0];
    if (safeUrl === '/') safeUrl = '/index.html';

    const filePath = path.normalize(path.join(__dirname, safeUrl));
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Access Denied');
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('404 Not Found');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        // HTTP Byte Range Request support for smooth video streaming
        const range = req.headers.range;
        if (range && (ext === '.mp4' || ext === '.webm')) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
            const chunksize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stats.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType
            });

            const stream = fs.createReadStream(filePath, { start, end });
            stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': stats.size,
                'Accept-Ranges': 'bytes',
                'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
            });

            fs.createReadStream(filePath).pipe(res);
        }
    });
});

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`\n======================================================`);
        console.log(`🚀 IMPACTATHON Synchronized Server Running!`);
        console.log(`📡 URL: http://localhost:${PORT}`);
        console.log(`🔒 Admin Password configured securely in .env`);
        console.log(`⏱️ Server-Side Shared Timer active on all clients`);
        console.log(`======================================================\n`);
    });
}

module.exports = server;
