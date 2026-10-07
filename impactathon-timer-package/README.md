# ⏱️ Impactathon Synchronized Countdown Timer

A high-fidelity, real-time digital countdown timer with animated video background, dynamic warning color shifts, audio alerts, second-by-second ticking audio, rapid delayed distortion glitch effects, and multi-device server-side synchronization.

---

## 🚀 Deploying to a New Vercel Account

To deploy this project to your new Vercel account:

### Method 1: Using the Vercel CLI
```bash
# 1. Inside this directory:
cd impactathon-timer-package

# 2. Log in to your new Vercel account:
npx vercel login

# 3. Deploy to production (select 'Y' to create a new project):
npx vercel --prod
```

### Method 2: Import via Vercel Dashboard / GitHub
1. Upload or push this folder (`impactathon-timer-package`) to a GitHub repository.
2. In your new Vercel Dashboard, click **"Add New..."** -> **"Project"** -> import the repository.
3. In **Settings -> Storage**, create a free **Vercel Blob** store (named e.g. `impactathon-timer-blob`) and connect it to your project. This provides real-time cross-device clock synchronization.
4. Set Environment Variables in Vercel:
   - `ADMIN_PASSWORD`: `dsg`
   - `SESSION_SECRET`: your secret key (optional, has built-in fallback)
5. Deploy! Your app will be live and synchronized across all connected devices.

---

## 🔄 1. Multi-Device Server-Side Synchronization

When you run the timer on **Laptop 1**, it runs in real time on **every other laptop, phone, or big-screen projector** viewing the website:
- **Centralized Server State**: Timer state (`isRunning`, `endTime`, `duration`, `pausedRemainingTime`) is stored centrally via `/api/timer` and Vercel Blob.
- **Clock Drift Compensation**: Clients calculate network latency and server timestamp offsets so every screen ticks in perfect lockstep, regardless of local device clock discrepancies.
- **Continuous Auto-Sync**: All devices poll the server every 1 second and re-sync immediately on window focus.
- **Secured Admin Controls**: Only admins entering the passcode (`dsg`) can Start, Pause, Reset, or Adjust the duration.

---

## 🔊 2. Tick Sound & Settings Toggle

- **Realistic Quartz Tick**: Every passing second produces a subtle, clean mechanical clock tick (with gentle alternating high/low pitches for even and odd seconds).
- **Settings Toggle**: Open the **Settings (Gear Icon)** to easily toggle **"Tick Sound"** on or off. The preference is remembered in `localStorage`.
- **Conclusion Alarm**: At 0s, triggers a soft 1.0-second buzzer and sweet crystalline E-major chimes with a red ambient screen overlay.

---

## 📁 Package Contents

```text
impactathon-timer-package/
├── index.html            # Main web application (Flip clock UI, audio, server sync)
├── style.css             # Precompiled minified Tailwind CSS (17 KB)
├── bg-video.mp4          # Seamless looping video background
├── tx-logo.png           # Impactathon header branding logo
├── server.js             # Standalone Node.js server (runs locally with /api/timer)
├── package.json          # Node project manifest (npm start)
├── vercel.json           # Vercel deployment routing & edge cache headers
├── .env                  # Environment variables (ADMIN_PASSWORD=dsg, PORT=3000)
├── .gitignore            # Git ignore rule for .env
├── api/
│   ├── timer.js          # Serverless Function for shared multi-device timer state
│   └── verify-admin.js   # Serverless Function for admin authentication
└── README.md             # This documentation
```

---

## 💻 Running Locally

### Option 1: Node.js (Multi-Device over Local Wi-Fi / LAN)
Inside the `impactathon-timer-package` folder, run:
```bash
npm start
# or: node server.js
```
Then open `http://localhost:3000` (or `http://<your-local-ip>:3000` from any other laptop on the same Wi-Fi network). The local server will synchronize all connected devices via `.timer-state.json`.

---

## ✨ Features & Controls

- **Digital Clock Animation**: Modern vertical slide/roll transitions when digits change every second.
- **Rapid Delayed Glitch Effect**: High-tech chromatic aberration RGB distortion glitch effect periodically bursting through the timer text.
- **Glassmorphic UI**: 70% translucent smoky frosted glass cards with dual-video crossfade background.
- **Dynamic Color Shifts**:
  - Normal: Crisp white flip clock text.
  - At **75% Time Concluded** (≤ 25% remaining): Text shifts to faint pale warning yellow (`#fef08a`).
  - At **Remaining 5%**: Text shifts to high-visibility urgent red (`#ef4444`).
- **Second-by-Second Tick Audio**: Authentic clock ticking sound with on/off toggle in Settings.
- **Picture-in-Picture (PiP)**: Pop the clock out into an always-on-top floating desktop window.
- **Master Admin Controls (Tinkethix Logo / Settings Passcode `dsg`)**:
  - Start, Pause, Reset (Hard Restart), and Custom Duration controls.
