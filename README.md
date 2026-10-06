# URL Shortener

A URL shortener with three deployment options: **AWS SAM** (Lambda + DynamoDB), **Vercel** (serverless functions + Upstash Redis), and **Render** (Node.js server + Upstash Redis).

---

## Architecture

```
Browser
  │
  ├─── Vercel deployment ──────────────────────────────────────────────
  │      CloudFront/Edge  →  public/index.html + app.js (static)
  │      Vercel Functions →  api/shorten.js, api/r/[code].js, etc.
  │                          └── Upstash Redis (data store)
  │
  ├─── Render deployment ──────────────────────────────────────────────
  │      Render Web Service  →  server.js (Node HTTP server)
  │                             └── Upstash Redis (data store)
  │      Frontend hosted on  →  Vercel / Netlify / any static host
  │
  └─── AWS SAM deployment ─────────────────────────────────────────────
         CloudFront  →  S3 (frontend)
         API Gateway →  Lambda functions
                        └── DynamoDB
```

---

## Project structure

```
url-shortener/
├── server.js               Node HTTP server (Render / local dev)
├── render.yaml             Render Blueprint (one-click backend deploy)
├── vercel.json             Vercel config (serverless functions + routing)
├── template.yaml           AWS SAM infrastructure
├── samconfig.toml          SAM deploy config (dev + prod)
├── .env.example            Environment variable reference
├── api/                    Vercel serverless functions
│   ├── shorten.js          POST /api/shorten
│   ├── urls.js             GET  /api/urls
│   ├── r/[code].js         GET  /{shortCode}  → redirect
│   ├── stats/[code].js     GET  /api/stats/:code
│   ├── urls/[code].js      DELETE /api/urls/:code
│   ├── auth/
│   │   ├── login.js        POST /api/auth/login
│   │   └── register.js     POST /api/auth/register
│   └── _lib/               Shared helpers (store, auth, redis)
├── src/                    Lambda handlers (AWS SAM)
│   ├── handlers/
│   └── lib/
├── frontend/
│   ├── index.html
│   └── app.js
├── scripts/
│   ├── build-frontend.js   Copies frontend/ → public/ and injects API_BASE
│   └── ...
└── tests/
```

---

## Quick start (local dev, no cloud needed)

```bash
npm install
npm run dev          # starts server.js on http://localhost:3000
```

Data is stored in `data/db.json` — no Docker, no Redis, no AWS needed.

---

## Deploy to Vercel + Render (recommended)

This is the simplest production setup:
- **Render** hosts the backend API (`server.js`)
- **Vercel** hosts the frontend + can also host the API as serverless functions

### Prerequisites

- [Upstash](https://upstash.com) account — free Redis database (data store for both platforms)
- [Vercel](https://vercel.com) account
- [Render](https://render.com) account
- Repo pushed to GitHub or GitLab

---

### Option A — Vercel (frontend + API together, simplest)

Everything runs on Vercel: the frontend is served as static files and the `api/` folder becomes serverless functions.

#### 1. Get Upstash credentials

1. Go to [console.upstash.com](https://console.upstash.com) → Create Database → pick a region → **REST API** tab
2. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

#### 2. Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel --prod
```

Or connect via the Vercel dashboard: **New Project → Import Git Repository**.

#### 3. Set environment variables in Vercel

In the Vercel dashboard → your project → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` | from Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | from Upstash console |
| `JWT_SECRET` | any long random string |
| `BASE_URL` | `https://your-app.vercel.app` |

#### 4. Redeploy

After adding env vars, trigger a redeploy from the Vercel dashboard (or push a commit).

Short links will look like: `https://your-app.vercel.app/abc1234`

---

### Option B — Render (backend) + Vercel (frontend)

Use this if you want the backend on a persistent server instead of serverless functions.

#### 1. Deploy the backend to Render

**Via Blueprint (one-click):**

1. Push this repo to GitHub/GitLab
2. Render dashboard → **New → Blueprint** → connect your repo
3. Render detects `render.yaml` and creates the `url-shortener-api` service
4. In the Render dashboard, set the secret env vars:

| Variable | Value |
|---|---|
| `JWT_SECRET` | any long random string |
| `UPSTASH_REDIS_REST_URL` | from Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | from Upstash console |

**Via manual setup:**

Render dashboard → **New → Web Service** → connect repo, then:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm install && cd src && npm install && cd ..` |
| Start Command | `node server.js` |
| Health Check Path | `/api/health` |

Add the same env vars as above, plus:

| Variable | Value |
|---|---|
| `BASE_URL` | `https://url-shortener-api.onrender.com` |
| `CORS_ORIGIN` | `https://your-app.vercel.app` |

#### 2. Deploy the frontend to Vercel

Once Render gives you a service URL (e.g. `https://url-shortener-api.onrender.com`):

```bash
# Set API_BASE so the frontend points at your Render backend
$env:API_BASE = "https://url-shortener-api.onrender.com"
node scripts/build-frontend.js    # creates public/ with correct config injected

vercel --prod
```

Or set `API_BASE` as an environment variable in the Vercel dashboard and let Vercel run the build command (`node scripts/build-frontend.js`) automatically.

#### 3. Tighten CORS on Render

Once you know your Vercel frontend URL, update the `CORS_ORIGIN` env var on Render to that URL and redeploy.

---

### Option C — AWS SAM (Lambda + DynamoDB)

See the [AWS SAM deployment section](#deploy-to-aws-sam) below for full instructions.

---

## Deploy to AWS SAM

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| AWS SAM CLI | ≥ 1.120 |
| AWS CLI | ≥ 2 (configured with credentials) |
| Docker | Required for `sam local` |

Install SAM CLI: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html

### First deploy (guided)

```bash
npm install
sam build && sam deploy --guided
```

SAM walks you through stack name, region, and parameters, then saves them to `samconfig.toml`.

Subsequent deploys:

```bash
npm run deploy:dev   # dev environment
npm run deploy:prod  # prod environment
```

### Upload the frontend (SAM)

After deploying, grab outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name url-shortener-dev \
  --query "Stacks[0].Outputs"
```

Build and upload frontend pointing at the API Gateway URL:

```bash
$env:API_BASE = "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/dev"
node scripts/build-frontend.js
aws s3 sync public/ s3://YOUR_BUCKET_NAME/ --delete
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

---

## Local development

```bash
npm install
npm run dev          # server.js on http://localhost:3000, uses data/db.json
```

No Docker or cloud services needed locally. To test with Redis locally:

```bash
cp .env.example .env
# Fill in UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
node server.js
```

### Run tests

```bash
npm test
npm run test:coverage
```

---

## Environment variables

See `.env.example` for the full reference. Key variables:

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes (prod) | Signs authentication tokens |
| `UPSTASH_REDIS_REST_URL` | Yes (prod) | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Yes (prod) | Upstash Redis auth token |
| `BASE_URL` | Yes (prod) | Public URL for generated short links |
| `CORS_ORIGIN` | No | Restrict API CORS (default `*`) |
| `PORT` | No | Server port (default `3000`, Render uses `10000`) |
| `API_BASE` | Build only | Frontend build: points app.js at backend URL |

---

### POST /shorten

**Request body:**

```json
{
  "url": "https://example.com/very/long/url",
  "alias": "my-link",        // optional, 3–50 chars, alphanumeric + hyphens
  "expiresAt": "2027-01-01T00:00:00Z"  // optional ISO 8601, must be > now+5min
}
```

**Response 201:**

```json
{
  "shortCode": "aB3xY9z",
  "shortUrl":  "https://short.example.com/aB3xY9z",
  "longUrl":   "https://example.com/very/long/url",
  "createdAt": "2026-09-12T10:00:00.000Z",
  "isCustomAlias": false,
  "expiresAt": "2027-01-01T00:00:00.000Z"   // omitted if no expiry
}
```

**Error codes:** 400 (invalid input), 409 (alias taken), 500.

---

### GET /{shortCode}

Returns a **301 redirect** to the original URL, or an HTML 404/410 page.

---

### GET /stats/{shortCode}

**Response 200:**

```json
{
  "shortCode":      "aB3xY9z",
  "longUrl":        "https://example.com/very/long/url",
  "clickCount":     128,
  "createdAt":      "2026-09-12T10:00:00.000Z",
  "lastAccessedAt": "2026-09-13T08:30:00.000Z",
  "isCustomAlias":  false,
  "isExpired":      false,
  "expiresAt":      "2027-01-01T00:00:00.000Z"
}
```

---

### GET /urls

Query params: `limit` (1–100, default 20), `cursor` (pagination token).

**Response 200:**

```json
{
  "items": [ ...url objects... ],
  "count": 20,
  "nextCursor": "base64encodedkey=="
}
```

---

### DELETE /urls/{shortCode}

Returns **204 No Content** on success, **404** if not found.

---

## Data model (DynamoDB)

| Attribute       | Type   | Notes                                      |
|-----------------|--------|--------------------------------------------|
| `shortCode`     | String | Partition key                              |
| `longUrl`       | String | Original URL (validated, normalised)       |
| `createdAt`     | String | ISO 8601                                   |
| `expiresAt`     | Number | Unix epoch seconds; DynamoDB TTL attribute |
| `clickCount`    | Number | Atomically incremented via ADD             |
| `lastAccessedAt`| String | ISO 8601; updated on each redirect         |
| `isCustomAlias` | Bool   | Whether the code was user-chosen           |
| `ownerId`       | String | Optional; for multi-tenant use             |

---

## Design decisions

### Short-code generation

- Uses `crypto.randomBytes` (CSPRNG) — not `Math.random()` — so codes are unpredictable.
- Base62 alphabet (`a-z A-Z 0-9`) gives 62^7 ≈ 3.5 trillion combinations.
- Rejection sampling eliminates modulo bias when converting bytes to alphabet indices.

### Collision handling

- DynamoDB `ConditionExpression: attribute_not_exists(shortCode)` is the atomic collision guard — the write itself prevents double-inserts.
- Auto-generated codes retry up to 5 times (astronomically unlikely to exhaust).
- Custom aliases return 409 immediately on collision — no retry, since the user chose the alias deliberately.

### Expiry

- `expiresAt` is stored as a Unix epoch (seconds) so DynamoDB TTL can consume it directly.
- We also check expiry on every read because DynamoDB TTL deletion can lag up to 48 hours.

### Security

- Blocked URL schemes: `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:`.
- SSRF mitigation: private/loopback IP ranges and the AWS metadata endpoint are blocked.
- Short codes echoed back in HTML error pages are HTML-escaped to prevent XSS.
- S3 bucket is private; CloudFront uses Origin Access Control (OAC) — no public bucket policy.

### Performance

- Lambda on Graviton2 (arm64) — ~20% cheaper and often faster than x86.
- Click increment is fire-and-forget on the redirect path — redirects are never delayed by analytics writes.
- AWS SDK v3 is modular — only the DynamoDB packages are bundled, keeping cold-start size minimal.
- Dependencies live in a Lambda Layer — individual function zips are tiny.

---

## Custom domain (optional)

1. Set `EnableCustomDomain=true` in your deploy parameters.
2. Set `CustomDomainName=short.yourdomain.com`.
3. Create an ACM certificate in `us-east-1` and set `AcmCertificateArn=arn:aws:acm:...`.
4. After deploy, create a Route 53 ALIAS record pointing to the CloudFront distribution domain.

---

## Free Tier notes (AWS SAM)

| Service       | Free Tier limit                       | Expected usage (demo)  |
|---------------|---------------------------------------|------------------------|
| Lambda        | 1M requests/month, 400K GB-sec/month  | Well within limits     |
| API Gateway   | 1M HTTP API calls/month               | Well within limits     |
| DynamoDB      | 25 GB storage, 25 WCU/RCU             | Well within limits     |
| CloudFront    | 1 TB data transfer, 10M requests/month| Well within limits     |
| S3            | 5 GB, 20K GET, 2K PUT requests/month  | Well within limits     |
