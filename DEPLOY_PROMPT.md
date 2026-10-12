# Deploy guide (written for a local Claude session)

You are deploying **Tailor** (this repo) to production on **Vercel** (web + Python API) with **Supabase**
(accounts + database). Work autonomously. The owner wants as few interruptions as possible:

- **Ask the owner only for:** `GEMINI_API_KEY` and `GROQ_API_KEY` (ask for both at the very start, together).
- If a website needs the owner to **log in or click "Authorize"**, open the page, tell them in one short line what to
  click, and continue as soon as it is done. Never ask them to type secrets into the chat other than the two keys.
- Generate everything else yourself (database password, salts). Never commit secrets to git. At the end, give the
  owner one summary with the live URL and where each secret lives.
- If a step fails, read the error, fix it, and retry. Check the **Troubleshooting** section first.

Repository: `https://github.com/sohamjadhav95/Dynamic-resume-creator`
Code to deploy: branch `claude/wonderful-fermat-oy6bti`, merged into `main` (step 1).

---

## 0. Tools

Check and install what's missing:

```bash
git --version
node --version         # need 22+
python3 --version      # need 3.12+ (only for local tests)
npm i -g vercel@latest
npx -y supabase@latest --version
gh --version           # optional, makes step 1 easier
```

## 1. Get the code onto `main`

```bash
git clone https://github.com/sohamjadhav95/Dynamic-resume-creator.git tailor && cd tailor
git fetch origin claude/wonderful-fermat-oy6bti
```

If `main` doesn't contain the new app yet (no `web/` folder on `main`), open a pull request from
`claude/wonderful-fermat-oy6bti` into `main` and merge it:

```bash
gh pr create --base main --head claude/wonderful-fermat-oy6bti --title "Tailor v2: multi-user app" --body "Production-ready rewrite."
gh pr merge --merge --delete-branch=false
git checkout main && git pull
```

(Without `gh`: do the same on github.com in the browser.)

Quick local check (should all pass):

```bash
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt && pytest -q
cd web && npm ci && npm test && npm run build && cd ..
```

## 2. Supabase project

```bash
npx supabase login                      # browser login (owner may need to click once)
npx supabase orgs list                  # note the org id
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
npx supabase projects create tailor --org-id <ORG_ID> --db-password "$DB_PASSWORD" --region ap-south-1
npx supabase projects list              # wait until the new project is ACTIVE_HEALTHY; note its REFERENCE ID
```

Pick the region closest to the owner's users (`ap-south-1` = Mumbai). Save `DB_PASSWORD` somewhere safe outside the
repo (tell the owner at the end).

Apply the database schema (tables, Row Level Security, the usage-limit function):

```bash
npx supabase link --project-ref <REF> -p "$DB_PASSWORD"
npx supabase db push                    # applies supabase/migrations/*.sql
```

If the CLI says the project isn't initialised, run `npx supabase init` (say **No** to the VS Code/IntelliJ questions).
It only adds `supabase/config.toml` and never touches the migrations. Don't commit `supabase/.temp`.

Get the API keys:

```bash
npx supabase projects api-keys --project-ref <REF> -o json
```

Use the **publishable** key (`sb_publishable_…`) and the **secret** key (`sb_secret_…`). If only legacy keys are listed,
use `anon` as the publishable key and `service_role` as the secret key; the app accepts both.
The project URL is `https://<REF>.supabase.co`.

## 3. Vercel project

```bash
vercel login                            # browser login (GitHub is easiest)
vercel link --yes --project tailor      # run in the repo root; creates the project
vercel git connect --yes                # auto-deploy on every push to main
```

Add environment variables to **Production** (and **Preview** too). Pipe values in so they don't end up in shell history:

```bash
add() { printf %s "$2" | vercel env add "$1" production; printf %s "$2" | vercel env add "$1" preview; }
add GEMINI_API_KEY "<from owner>"
add GROQ_API_KEY "<from owner>"
add SUPABASE_URL "https://<REF>.supabase.co"
add SUPABASE_PUBLISHABLE_KEY "<sb_publishable_…>"
add SUPABASE_SECRET_KEY "<sb_secret_…>"
add IP_HASH_SALT "$(openssl rand -hex 32)"
```

**Fluid compute must be ON** (it allows the 300-second AI requests on the free plan). It's on by default for new
projects. Check it under Vercel dashboard → Project → Settings → Functions → Fluid Compute.

Deploy:

```bash
vercel deploy --prod
```

Note the production domain (e.g. `https://tailor-xyz.vercel.app`; see `vercel project ls` or the dashboard). Then set
the allowed origin and redeploy:

```bash
add ALLOWED_ORIGINS "https://<PRODUCTION_DOMAIN>"
vercel deploy --prod
```

## 4. Supabase sign-in settings

Create a Supabase personal access token at https://supabase.com/dashboard/account/tokens (browser) and export it as
`SUPABASE_ACCESS_TOKEN`. Then point Auth at the live site:

```bash
curl -sS -X PATCH "https://api.supabase.com/v1/projects/<REF>/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"site_url":"https://<PRODUCTION_DOMAIN>","uri_allow_list":"https://<PRODUCTION_DOMAIN>/**,http://localhost:5173/**"}'
```

(Dashboard alternative: Authentication → URL Configuration → Site URL + Redirect URLs.)

Email magic links now work. Supabase's built-in email sender only sends a few emails per hour, which is fine to start.
Mention to the owner that adding custom SMTP (e.g. Resend) under Authentication → Emails removes that limit.

### Google sign-in

In Google Cloud Console (https://console.cloud.google.com), using the browser:

1. Create a project named **Tailor**.
2. **APIs & Services → OAuth consent screen**: External, app name "Tailor", support email = owner's email,
   authorized domain = `supabase.co` and the Vercel domain. Publish the app (or keep it in Testing, adding the owner as a test user).
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URI: `https://<REF>.supabase.co/auth/v1/callback`
4. Copy the client ID and secret, then enable Google in Supabase:

```bash
curl -sS -X PATCH "https://api.supabase.com/v1/projects/<REF>/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"external_google_enabled":true,"external_google_client_id":"<CLIENT_ID>","external_google_secret":"<CLIENT_SECRET>"}'
```

If Google setup is blocked for any reason, skip it: email sign-in still works. Report it to the owner as the one open item.

## 5. Smoke test the live site

```bash
SITE=https://<PRODUCTION_DOMAIN>
curl -sS $SITE/api/health
# expect: {"ok":true,"ai":{"gemini":true,"groq":true},"accounts":true}

python3 - > /tmp/tailor-body.json <<'EOF'
import json
print(json.dumps({"resume": json.load(open("web/src/data/sample-resume.json")),
  "job_description": open("web/src/data/sample-job.ts").read().split("`")[1]}))
EOF
curl -sSN -X POST $SITE/api/tailor -H 'content-type: application/json' --data @/tmp/tailor-body.json | grep '^event'
# expect: stage … (thought/progress …) … result   — and the result data has "engine": "gemini"

# The fallback path (a fake personal key makes Gemini fail; the app must still answer):
curl -sSN -X POST $SITE/api/tailor -H 'content-type: application/json' \
  -H 'x-gemini-key: AIzaInvalidKeyForSmokeTest0000000000000' --data @/tmp/tailor-body.json | grep '^event'
# expect the last event to be: fallback   (the browser then makes the offline version)
```

In a browser at `$SITE`:
1. Click **Try with a sample** → **Tailor my resume**. Live progress should show, then "Done with Gemini".
2. Click a bullet → **Stronger**. Three options should appear.
3. Click **PDF**. The print dialog shows one A4 page.
4. **Sign in** with email (and Google if set up). The resume should still be there after a reload.
5. In Supabase → Table editor, `master_resumes` should have 1 row.

## 6. Report to the owner

Send one short message with:
- The live URL.
- What works: AI (Gemini + Groq backup + offline), email sign-in, Google sign-in (or why not), auto-deploy on push to `main`.
- Where the secrets are: Vercel env vars, Supabase dashboard; the DB password (give it to them to keep in a password manager).
- Any follow-ups: custom SMTP for email, a custom domain (Vercel → Domains, then add it to `ALLOWED_ORIGINS` and the Supabase redirect URLs).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/api/...` returns 404 | `vercel.json` must be in the repo root, and `api/index.py` must exist. Redeploy. |
| `/api/health` 500 "No module named backend" | Check `includeFiles: "backend/**"` in `vercel.json`, and that `requirements.txt` is at the root. |
| AI requests stop at ~60 s | Fluid compute is off. Turn it on (Settings → Functions) and redeploy. |
| `"ai":{"gemini":false…}` | Env var missing in Production. `vercel env ls`, add it, **redeploy**. |
| Sign-in link opens localhost or errors "redirect not allowed" | Fix Site URL / Redirect URLs (step 4). |
| Google: `redirect_uri_mismatch` | The Google OAuth redirect URI must be exactly `https://<REF>.supabase.co/auth/v1/callback`. |
| `db push` asks for a password / fails to connect | Re-run `npx supabase link --project-ref <REF> -p "$DB_PASSWORD"`. On IPv4-only networks add `--dns-resolver https`. |
| Usage limits never trigger | `SUPABASE_SECRET_KEY` is missing or wrong; the API then allows requests by design. Check the Vercel logs for `limits.unavailable`. |
| Gemini model errors (404) | The model list changed. Set `GEMINI_MODELS` to models listed at https://ai.google.dev/gemini-api/docs/models and redeploy. |
| Build fails on Node version | Vercel → Settings → General → Node.js Version → 22.x. |
