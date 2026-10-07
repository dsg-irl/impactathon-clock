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
    // Real-time zero-cache headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        const now = Date.now();
        try {
            if (process.env.BLOB_READ_WRITE_TOKEN) {
                // List latest state blobs using immutable prefix pattern (100% bypasses CDN cache)
                const { blobs } = await list({ prefix: 'timer-state-' });
                if (blobs && blobs.length > 0) {
                    const sorted = blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
                    const latestBlob = sorted[0];
                    const blobRes = await fetch(latestBlob.url, { cache: 'no-store' });
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

            // Immutable write: store with unique timestamp to guarantee instant 0-cache propagation
            if (process.env.BLOB_READ_WRITE_TOKEN) {
                const blobName = `timer-state-${now}.json`;
                await put(blobName, JSON.stringify(newState), {
                    access: 'public',
                    addRandomSuffix: false
                });

                // Clean up older blobs in background
                list({ prefix: 'timer-state-' }).then(({ blobs }) => {
                    if (blobs && blobs.length > 2) {
                        const oldBlobs = blobs
                            .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
                            .slice(2);
                        for (const b of oldBlobs) {
                            del(b.url).catch(() => {});
                        }
                    }
                }).catch(() => {});
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
