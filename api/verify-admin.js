const crypto = require('crypto');

module.exports = (req, res) => {
    // CORS & No-cache headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
        let password = '';
        if (req.body) {
            password = typeof req.body === 'string' ? JSON.parse(req.body).password : req.body.password;
        }

        if (typeof password !== 'string') {
            return res.status(400).json({ success: false, message: 'Invalid password format' });
        }

        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dsg';
        const SESSION_SECRET = process.env.SESSION_SECRET || 'impactathon_secret_fallback_key';

        // Constant-time hash comparison to eliminate timing attacks
        const userHash = crypto.createHash('sha256').update(String(password)).digest();
        const actualHash = crypto.createHash('sha256').update(String(ADMIN_PASSWORD)).digest();
        const isMatch = crypto.timingSafeEqual(userHash, actualHash);

        if (isMatch) {
            // Generate a secure signed session token with timestamp
            const payload = `${Date.now()}`;
            const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
            const token = `${payload}.${signature}`;

            return res.status(200).json({ success: true, token });
        } else {
            return res.status(401).json({ success: false, message: 'Incorrect password' });
        }
    } catch (err) {
        return res.status(400).json({ success: false, message: 'Malformed request payload' });
    }
};
