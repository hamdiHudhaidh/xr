# XR Hub Display

Portrait signage page for a **1080×1920** screen.

Loop: schedule poster for 60 seconds, then the YouTube video for its full duration, then the poster again.

Open **https://hamdihudhaidh.github.io/xr/** on the display. Tap once for fullscreen and sound (browsers block unmuted autoplay).

Optional: `?img=3` shows the poster for 3 seconds, useful for testing the video switch.

## /in, /out, /admin, /numbers

- `/out/` (and `/`): poster 60 s, then the video, looped.
- `/in/`: schedule only, with finished sessions greyed, and today's assigned people shown as rocking avatars (or initials) with names underneath. Swaps are applied. People marked off for that date appear in an Off today panel beside the schedule. Once a session has finished, any saved participant and engagement counts appear on that session in purple. Test with `?now=HH:MM&date=YYYY-MM-DD`.
- `/admin/`: teams, per-person photos, session assignments (a default for every day, plus per-day changes), per-session swaps, and per-date off days. Data lives in the `xr-admin-api` Cloudflare Worker (`worker/`), whose URL goes in `config.js` (`XR_API`).
- `/numbers/`: passcode-gated counters for each session's participants and engagement, saved per date. Counts show on `/in` after that session ends.

Worker: `cd worker && npx wrangler deploy`, then `npx wrangler secret put ADMIN_PASSCODE`. Local test: `npx wrangler dev --local` (passcode in `worker/.dev.vars`), then open `http://127.0.0.1:8765/admin/?api=http://127.0.0.1:8787`.
