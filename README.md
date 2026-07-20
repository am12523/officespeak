# OfficeSpeak AI

Rewrite messages for Slack, email, meetings, and performance reviews while preserving your intent. Pick a voice (Professional, Assertive, Diplomatic, Executive, HR, Technical, Passive-aggressive), stack adjustments (more to the point, less snarky, bullet points, easier to understand…), and get back a channel-appropriate rewrite with a redline explaining every change, before/after scoring, and a reverse mode that decodes corporate-speak into plain English.

## Architecture

```
React (Vite)
    │  POST /api/translate  {text, mode, tone, context, modifiers, compare}
    ▼
FastAPI
    │── prompts.py     versioned prompt templates (strict-JSON contracts)
    │── llm.py         provider-agnostic LLM layer (Gemini free tier by
    │                  default, Anthropic optional) + token & cost accounting
    │── models.py      SQLAlchemy → SQLite (dev) / Postgres (prod)
    │── analytics.py   aggregates for the dashboard
    ▼
Analytics: tone/channel distribution, avg professionalism lift,
top rewritten phrases, cost per request, token usage, latency, feedback
```

## Features

- **Forward mode** — casual → corporate for a chosen channel (Slack, Email, Teams, In person, Performance review, Client call) and voice, with stackable adjustments. Spoken channels (In person, Client call) produce sentences you could actually say out loud — no sign-offs or written formatting.
- **Intent protection** — the prompt hard-codes direction-of-criticism preservation: "you are too stupid to explain things to" stays criticism of the *other* person's comprehension (diplomatically), never gets flipped into the sender's own shortcoming.
- **Redline explanations** — every rewrite lists `casual phrase → replacement` with a one-line reason.
- **Before/after scoring** — buzzword density, readability, professionalism scored for both the original and the rewrite; the UI shows the lift.
- **Reverse mode** — corporate → plain English, with a decoder ring and a cynical subtext line.
- **Compare all voices** — one request returns all seven variants side by side.
- **Refine loop** — not happy with a result? One-tap Shorter / Longer / Softer / More direct, or a free-text instruction ("mention the Friday deadline"); the model revises its own previous output, shows a redline of the revision, and re-scores it.
- **Analytics** — session analytics in the UI plus persistent server analytics: request volume, tone/channel mix, average professionalism lift, most-rewritten phrases, total/average cost, tokens, latency, and thumbs feedback.
- **Cost tracking** — every request stores `input_tokens`, `output_tokens`, and computed USD cost (prices configurable via env).

## Quick start (local, SQLite)

```bash
# 1. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEY=AIza...            # free key: https://aistudio.google.com/apikey
uvicorn app.main:app --reload            # http://localhost:8000  (docs at /docs)

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                              # http://localhost:5173, /api proxied to :8000
```

## Run everything with Docker (Postgres)

```bash
cp .env.example .env    # put your GEMINI_API_KEY in .env
docker compose up --build
# frontend http://localhost:4173 · API http://localhost:8000 · Postgres persisted in a volume
```

## Tests

```bash
cd backend && pytest
```

Twelve tests cover the prompt templates (tone/context/modifier injection, JSON contracts) and the API (translate persistence, validation, feedback, analytics aggregation) with the LLM mocked — so the suite runs offline, free, and fast.

## API

| Method | Path                     | Purpose                                        |
| ------ | ------------------------ | ---------------------------------------------- |
| POST   | `/api/translate`         | Rewrite/decode/compare; persists + returns meta |
| POST   | `/api/feedback`          | Thumbs up/down on a translation                |
| GET    | `/api/analytics/summary` | Aggregates for the dashboard                   |
| GET    | `/api/analytics/recent`  | Recent requests                                |
| GET    | `/health`                | Liveness + configured model                    |

Example:

```bash
curl -s localhost:8000/api/translate -H 'content-type: application/json' -d '{
  "text": "no way I can finish this today",
  "tone": "executive", "context": "email", "modifiers": ["concise"]
}'
```

## Deployment

### Option A — one service on Render (recommended, free)

The root `Dockerfile` builds the React app and has FastAPI serve it, so the
whole product lives at a single URL — no CORS, no split deploys.

1. Push this repo to GitHub.
2. Get a free Gemini key at https://aistudio.google.com/apikey.
3. (Optional but recommended) create a free Postgres database at https://neon.tech and copy its connection string — SQLite works too, but Render's disk is wiped on every redeploy, so your analytics history would reset.
4. On https://render.com: **New → Web Service → connect the repo**. Render detects the Dockerfile (or the included `render.yaml` blueprint).
5. Set env vars: `GEMINI_API_KEY`, and `DATABASE_URL` if using Neon (use the `postgresql+psycopg2://...` form).
6. Deploy. Your app is live at `https://<name>.onrender.com` — frontend at `/`, API docs at `/docs`, health at `/health`.

Note: Render's free tier sleeps after inactivity; the first request after a while takes ~30s to wake. Fine for a portfolio, and the URL goes straight on your resume.

### Option B — split deploy (Vercel frontend + Render backend)

Better cold-start feel, since Vercel's static hosting never sleeps.

1. Deploy only the backend on Render (root directory `backend`, its own Dockerfile), env vars as above, plus `CORS_ORIGINS=https://<your-app>.vercel.app`.
2. In `frontend/index.html`, set `window.OFFICESPEAK_API = "https://<your-backend>.onrender.com"`.
3. On Vercel: import the repo, set root directory to `frontend`, framework Vite. Deploy.

### Option C — Chrome extension (a v2, not a starting point)

An extension is a *client*: it still needs the hosted backend from Option A/B. Once that exists, the extension is a Manifest V3 popup (or a right-click "rewrite selection" context menu) that POSTs the selected text to your `/api/translate` and shows the rewrite. It's a great follow-up feature — deploy the web app first so there's an API to point it at.

## Switching or adding LLM providers

`app/llm.py` is a thin provider layer: `complete()` dispatches on `LLM_PROVIDER`.

- **Gemini (default)** — free tier via Google AI Studio; JSON output is enforced with `responseMimeType: application/json`, and cost defaults to $0.
- **Anthropic** — set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`.
- **Grok / others** — xAI's API is OpenAI-compatible but **not free**; adding it (or OpenAI, Mistral, etc.) is one new `_provider()` function returning `(parsed_json, meta)`.

## Design decisions worth mentioning in an interview

- Voice is single-select but adjustments are multi-select — mirrors how people actually think ("executive, but shorter, as bullets") and avoids a 15-way tone dropdown.
- Prompts demand strict JSON and are unit-tested as templates; parsing is defensive (fence stripping, brace slicing) with a 502 surfaced on model misbehavior.
- Scoring both the input and the output turns a gimmick metric into a real one: professionalism *lift* per request, aggregated over time.
- Cost per request is computed at write time from token usage, so the analytics dashboard doubles as an LLM cost monitor.
- The LLM layer is provider-agnostic behind one function signature, so swapping Gemini for Anthropic (or adding Grok/OpenAI) touches zero routes, models, or prompts.
