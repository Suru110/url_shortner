# URL Shortener — Serverless on AWS

A fully serverless URL shortener built with AWS Lambda (Node.js 20), API Gateway HTTP API, DynamoDB, S3, and CloudFront, deployed via AWS SAM.

---

## Architecture

```
Browser / CLI
     │
     ▼
CloudFront ──── S3 (frontend: index.html + app.js)
     │
     │ /shorten, /stats/*, /urls, /urls/*
     ▼
API Gateway (HTTP API)
     │
     ├── POST /shorten        → ShortenFunction
     ├── GET  /{shortCode}    → RedirectFunction
     ├── GET  /stats/{code}   → StatsFunction
     ├── GET  /urls           → ListUrlsFunction
     └── DELETE /urls/{code}  → DeleteUrlFunction
                │
                ▼
           DynamoDB (urls-{env})
           PK: shortCode
           TTL: expiresAt
```

---

## Project structure

```
url-shortener/
├── template.yaml           SAM infrastructure (Lambda, API GW, DynamoDB, S3, CloudFront)
├── samconfig.toml          SAM deploy config for dev + prod environments
├── package.json
├── env.local.json          Local env vars for sam local (git-ignored)
├── src/
│   ├── handlers/
│   │   ├── shorten.js      POST /shorten
│   │   ├── redirect.js     GET /{shortCode}
│   │   ├── stats.js        GET /stats/{shortCode}
│   │   ├── listUrls.js     GET /urls
│   │   └── deleteUrl.js    DELETE /urls/{shortCode}
│   └── lib/
│       ├── db.js           DynamoDB DocumentClient wrapper
│       ├── generator.js    base62 short-code generator (CSPRNG)
│       ├── response.js     HTTP response helpers + structured logger
│       └── validator.js    URL validation + sanitisation
├── frontend/
│   ├── index.html
│   └── app.js
└── tests/
    ├── generator.test.js
    ├── validator.test.js
    ├── shorten.test.js
    ├── redirect.test.js
    └── stats.test.js
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| AWS SAM CLI | ≥ 1.120 |
| AWS CLI | ≥ 2 (configured with credentials) |
| Docker | Required for `sam local` |

Install SAM CLI: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Run tests

```bash
npm test
# with coverage
npm run test:coverage
```

### 3. Deploy to AWS (guided first deploy)

```bash
sam build && sam deploy --guided
```

SAM will walk you through stack name, region, and parameters. Afterwards these are saved to `samconfig.toml`.

Subsequent deploys:

```bash
npm run deploy:dev   # dev environment
npm run deploy:prod  # prod environment
```

### 4. Upload the frontend

After deploying, grab the S3 bucket name from the stack outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name url-shortener-dev \
  --query "Stacks[0].Outputs"
```

Then edit `frontend/app.js` — replace `YOUR_API_ID` with your actual API Gateway ID, then upload:

```bash
aws s3 sync frontend/ s3://YOUR_BUCKET_NAME/ --delete
```

The CloudFront URL is printed in the stack outputs.

---

## Local development

### Start DynamoDB Local

```bash
docker run -p 8000:8000 amazon/dynamodb-local
```

Create the local table (one-time):

```bash
aws dynamodb create-table \
  --table-name urls-local \
  --attribute-definitions AttributeName=shortCode,AttributeType=S \
  --key-schema AttributeName=shortCode,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000 \
  --region us-east-1
```

### Start SAM local API

```bash
npm run local:api
# Equivalent: sam local start-api --env-vars env.local.json
```

The API is now at `http://localhost:3000`.

### Test the API locally

```bash
# Shorten a URL
curl -X POST http://localhost:3000/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/some/long/path"}'

# Redirect (follow the redirect)
curl -L http://localhost:3000/ABC1234

# Stats
curl http://localhost:3000/stats/ABC1234

# List all
curl http://localhost:3000/urls

# Delete
curl -X DELETE http://localhost:3000/urls/ABC1234
```

---

## API reference

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

## Environment variables

| Variable            | Description                              | Default                    |
|---------------------|------------------------------------------|----------------------------|
| `URLS_TABLE`        | DynamoDB table name                      | `urls`                     |
| `BASE_URL`          | Public base URL for short links          | API Gateway URL            |
| `CORS_ORIGIN`       | Allowed CORS origin                      | `*`                        |
| `DYNAMODB_ENDPOINT` | Override DynamoDB endpoint (local dev)   | AWS default                |
| `AWS_REGION`        | AWS region                               | `us-east-1`                |

---

## Free Tier notes

| Service       | Free Tier limit                       | Expected usage (demo)  |
|---------------|---------------------------------------|------------------------|
| Lambda        | 1M requests/month, 400K GB-sec/month  | Well within limits     |
| API Gateway   | 1M HTTP API calls/month               | Well within limits     |
| DynamoDB      | 25 GB storage, 25 WCU/RCU             | Well within limits     |
| CloudFront    | 1 TB data transfer, 10M requests/month| Well within limits     |
| S3            | 5 GB, 20K GET, 2K PUT requests/month  | Well within limits     |
