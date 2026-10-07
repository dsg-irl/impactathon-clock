const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');

const DEFAULT_STATE = {
    isRunning: false,
    duration: 6 * 60 * 60 * 1000,
    pausedRemainingTime: 6 * 60 * 60 * 1000,
    endTime: 0,
    updatedAt: 0
};

// Fallback in-memory state for local testing or when blob is unavailable
let inMemoryState = { ...DEFAULT_STATE };
let lastBlobFetch = 0;
let cachedBlobUrl = null;
const BLOB_CACHE_MS = 15000; // 15 seconds in-memory cache timestep

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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        const now = Date.now();
        // Edge CDN Cache: Vercel CDN caches response for 6 seconds, cutting requests further
        res.setHeader('Cache-Control', 'public, max-age=6, s-maxage=6, stale-while-revalidate=12');

        // 1. Fast in-memory cache: if read within last 15s, return instantly with 0 Blob requests
        if (now - lastBlobFetch < BLOB_CACHE_MS && inMemoryState.updatedAt > 0) {
            const state = { ...inMemoryState };
            if (state.isRunning && state.endTime > 0 && now >= state.endTime) {
                state.isRunning = false;
                state.pausedRemainingTime = 0;
                state.endTime = 0;
            }
            return res.status(200).json({
                success: true,
                state,
                serverTime: now
            });
        }

        try {
            if (process.env.BLOB_READ_WRITE_TOKEN) {
                // Fetch blob only once every 10 seconds
                lastBlobFetch = now;
                let fetchUrl = cachedBlobUrl;

                if (!fetchUrl) {
                    const { blobs } = await list({ prefix: 'timer-state' });
                    if (blobs && blobs.length > 0) {
                        const sorted = blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
                        fetchUrl = sorted[0].url;
                        cachedBlobUrl = fetchUrl;
                    }
                }

                if (fetchUrl) {
                    const blobRes = await fetch(fetchUrl + (fetchUrl.includes('?') ? '&' : '?') + `_t=${now}`, { cache: 'no-store' });
                    if (blobRes.ok) {
                        const rawState = await blobRes.json();
                        const state = { ...DEFAULT_STATE, ...rawState };
                        if (state.isRunning && state.endTime > 0 && now >= state.endTime) {
                            state.isRunning = false;
                            state.pausedRemainingTime = 0;
                            state.endTime = 0;
                        }
                        inMemoryState = state;
                        return res.status(200).json({
                            success: true,
                            state,
                            serverTime: now
                        });
                    }
                }
            }

            const state = { ...DEFAULT_STATE, ...(inMemoryState || {}) };
            if (state.isRunning && state.endTime > 0 && now >= state.endTime) {
                state.isRunning = false;
                state.pausedRemainingTime = 0;
                state.endTime = 0;
            }
            return res.status(200).json({
                success: true,
                state,
                serverTime: now
            });
        } catch (err) {
            console.error('Error fetching state:', err);
            return res.status(200).json({
                success: true,
                state: inMemoryState || DEFAULT_STATE,
                serverTime: now
            });
        }
    }

    if (req.method === 'POST') {
        try {
            let authHeader = req.headers.authorization || '';
            let token = authHeader.replace(/^Bearer\s+/i, '').trim();

            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch(e) { body = {}; }
            }
            body = body || {};

            token = token || body.token || '';

            const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dsg';
            const SESSION_SECRET = process.env.SESSION_SECRET || 'impactathon_secret_fallback_key';

            // Verify authorization
            let isAuthorized = false;
            if (body.adminPassword) {
                const userHash = crypto.createHash('sha256').update(String(body.adminPassword)).digest();
                const actualHash = crypto.createHash('sha256').update(String(ADMIN_PASSWORD)).digest();
                isAuthorized = crypto.timingSafeEqual(userHash, actualHash);
            } else if (token) {
                isAuthorized = verifySessionToken(token, SESSION_SECRET);
            }

            if (!isAuthorized) {
                return res.status(401).json({ success: false, message: 'Unauthorized. Admin credentials required.' });
            }

            const now = Date.now();
            const duration = Math.max(1000, Number(body.duration) || (6 * 60 * 60 * 1000));
            const isRunning = Boolean(body.isRunning);
            let pausedRemainingTime = Number(body.pausedRemainingTime);
            if (isNaN(pausedRemainingTime)) pausedRemainingTime = duration;

            // Server is the master timekeeper: calculate authoritative endTime
            let endTime = 0;
            if (isRunning) {
                endTime = now + pausedRemainingTime;
            } else {
                endTime = 0;
            }

            const newState = {
                isRunning,
                duration,
                pausedRemainingTime,
                endTime,
                updatedAt: now
            };

            inMemoryState = newState;

            // Single static blob write (zero wasteful lists and zero deletes)
            if (process.env.BLOB_READ_WRITE_TOKEN) {
                try {
                    const blobResult = await put('timer-state.json', JSON.stringify(newState), {
                        access: 'public',
                        addRandomSuffix: false
                    });
                    if (blobResult && blobResult.url) {
                        cachedBlobUrl = blobResult.url;
                    }
                    lastBlobFetch = now;
                } catch(e) {
                    console.error("Blob write error:", e);
                }
            }

            return res.status(200).json({
                success: true,
                state: newState,
                serverTime: now
            });
        } catch (err) {
            console.error('Error saving state:', err);
            return res.status(500).json({ success: false, message: 'Failed to save timer state' });
        }
    }

    res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
};
