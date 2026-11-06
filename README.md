# JobPilot PK (SaaS) - Node.js

A subscription website: home page with two plans, sign up and log in, manual payment approval (screenshot), plan-based limits,
job search through **Firecrawl**, resume matching, cover letters, application tracker, and a private admin panel.
**No Python.** Backend is Node.js; the front end is plain HTML/CSS/JS with no build step.

## Run it
1. Install Node.js 20 or newer (nodejs.org).
2. In this folder: `npm install`
3. Copy `.env.example` to `.env` and fill it in (admin email and password, payment details, `FIRECRAWL_API_KEY`).
4. `npm start` and open http://localhost:3000. (Windows: double-click `start.bat`.)

Admin panel: http://localhost:3000/admin (log in at /login with ADMIN_EMAIL and ADMIN_PASSWORD).

## Plans and limits
Edit **lib/plans.js** (the only place). The home page, signup page and server limits all read from it.

| | Starter Rs. 2,500 | Pro Rs. 5,000 |
|---|---|---|
| Searches per day | 5 | 25 |
| Ranked jobs per search | 10 | 25 |
| Full job-page reading (sharper match) | no | top 10 |
| Career-page links per search | 2 | 8 |
| AI cover letters per month* | template letters only | 60 (+ unlimited templates) |
| Tracker size | 100 | 2,000 |

*AI letters appear on the plans only when `ANTHROPIC_API_KEY` is set.

## How Firecrawl is used (and what it costs you)
- **Search:** one Firecrawl `/v2/search` call per new search (past month, country-targeted when the location is recognised).
- **Pro deep reads:** `/v2/scrape` markdown of the top 10 leads (1 credit each).
- **Career links:** `/v2/scrape` with JSON extraction (about 5 credits each).
- LinkedIn, Indeed, Glassdoor and social sites are never scraped. Their links may appear in results as leads the user opens themselves.
- Results are cached (searches 6 hours, pages 24 hours, shared by all users), and `FIRECRAWL_DAILY_CALLS` caps total calls per day.
- Rough credits per uncached search: Starter about 4 + 5 per career link; Pro about 10 + 10 + 5 per career link. Check your Firecrawl plan's current limits and prices.
- The key lives only in `.env` on the server. Never put it in the front-end or share it in chat.

## Customer and admin flow
Customer: choose plan, pay by JazzCash/Easypaisa, sign up with the screenshot, wait for approval, log in.
Admin (/admin): see pending payments with screenshots, approve with plan and days, reject, extend, change plan, suspend, reset password, delete.
Expired users sign up again with the same email and password to send a new payment.

## Hosting (any host that runs Node.js)
- **VPS** (Ubuntu): install Node 20, `npm install --omit=dev`, run with `pm2 start server.js`, put Caddy or nginx in front for HTTPS.
- **Render / Railway / Fly.io**: build `npm install`, start `npm start`, attach a **persistent disk** and set `DB_PATH` to a file on it.
- **Docker**: `docker build -t jobpilot . && docker run -p 3000:3000 -v jobpilot-data:/data --env-file .env jobpilot`
- **cPanel "Setup Node.js App"**: point it at server.js and set the environment variables in the panel.
- Run **one instance only** (SQLite). Set `NODE_ENV=production` and `TRUST_PROXY=1` behind HTTPS. Back up the database file (and its `-wal`/`-shm` files, or use `sqlite3 app.db ".backup copy.db"`) every day.

## Porting the backend to another language (PHP, Java, Go, C#...)
The front end only talks to the JSON API below, so you can rewrite `server.js` and `lib/` in any language and keep `public/` unchanged.
Sessions are an HttpOnly `sid` cookie. Tables: users, sessions, profiles, apps, usage, cache (see lib/db.js).

| Endpoint | Purpose |
|---|---|
| GET /api/plans | plans, benefits, payment text |
| POST /api/signup, /api/login, /api/logout | accounts |
| GET /api/me | user, plan limits, usage |
| GET/POST/DELETE /api/profile, POST/GET/DELETE /api/resume(/download) | profile and saved resume |
| POST /api/search | job search (enforces plan limits) |
| POST /api/letter | cover letter |
| GET/POST /api/apps, PATCH /api/apps/:id, GET /api/apps.csv | tracker |
| GET /api/admin/overview, GET /api/admin/shot/:id, POST /api/admin/{approve,status,password,delete} | admin |

## Tests
`npm test` runs 17 tests (API and a browser simulation of every page) against fake Firecrawl and Claude servers, so no keys or credits are used.
**Not tested here:** the live Firecrawl API (the request format was checked against its documentation). Run one real search with your key after deploying.

## Known limits
Manual approval (no payment gateway); SQLite suits dozens to a few hundred active users; the match score is keyword-based and approximate;
search results are leads from the open web, not a complete job database; pages that need a login cannot be read.
Add a privacy policy and terms before selling: you store names, emails, resumes and payment screenshots.
