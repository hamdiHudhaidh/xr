# XR Hub Display

Portrait signage page for a **1080×1920** screen.

Loop: schedule poster for 60 seconds, then the YouTube video for its full duration, then the poster again.

Open **https://hamdihudhaidh.github.io/xr/** on the display. Tap once for fullscreen and sound (browsers block unmuted autoplay).

Optional: `?img=3` shows the poster for 3 seconds, useful for testing the video switch.

## /in, /out, /admin, /clicker, /kpi, /fares

- `/out/` (and `/`): poster 60 s, then the video, looped.
- `/in/`: schedule for 15 seconds, then the KPI night scene for 15 seconds, repeating. The KPI scene is preloaded in an iframe (`/kpi/?embed=1`) so the switch does not reload it. Finished sessions are greyed, with today's assigned people shown as rocking avatars (or initials) and names underneath. Swaps are applied. People marked off for that date appear in an Off today panel beside the schedule. Once a session has finished, any saved participant and engagement counts appear on that session in purple. Test with `?now=HH:MM&date=YYYY-MM-DD`. Use `?hold=schedule` or `?hold=kpi` to freeze one view.
- `/admin/`: teams, per-person photos, session assignments (a default for every day, plus per-day changes), per-session swaps, and per-date off days, plus a passcode-gated Numbers tab for correcting participant and engagement counts on any day. Data lives in the `xr-admin-api` Cloudflare Worker (`worker/`), whose URL goes in `config.js` (`XR_API`).
- `/clicker/`: no passcode. Facilitators count only today's sessions (Asia/Riyadh), with large +/− buttons for participants and engagement and a daily total. It cannot open other days. Saves go to `PUT /clicker` on the Worker (today-only, rate-limited). The full `PUT /data` stays passcode-only.
- `/fares/` (and `/Fares/`): public, read-only session numbers for the collector. Pick any event day (Asia/Riyadh, or `?date=YYYY-MM-DD`) to see each session's time, assigned team and members (swaps applied), participants, engagement and combined count, plus the daily total. Sessions with no saved count are marked not yet counted. It only reads `GET /data`; it cannot write.
- `/kpi/`: public 1920×1080 night scene of the event (12–30 Nov): a woods clearing, Ithra and Expo behind the trees, exact-count 3D piles of headsets (participants) and cubes (engagement) for every day, and the team sitting around the bonfire. Totals sit in the sky. Empty days show a dashed mark.

Worker: `cd worker && npx wrangler deploy`, then `npx wrangler secret put ADMIN_PASSCODE`. Local test: `npx wrangler dev --local` (passcode in `worker/.dev.vars`), then open `http://127.0.0.1:8765/admin/?api=http://127.0.0.1:8787` or `http://127.0.0.1:8765/clicker/?api=http://127.0.0.1:8787`. Deploy the Worker only after the `/clicker` endpoint is approved: `cd worker && export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_WORKERS_TOKEN" && npx wrangler deploy`.
