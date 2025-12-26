# 🔐 KeyManagement (Central Secret Gateway)

This repo contains a **Cloudflare Worker** that acts as a **central secret gateway**.

It allows GitHub Actions (across many repos) to securely fetch a GitLab token **without storing that token in each repo**.

This setup was chosen to optimize for:

* ✅ Minimal mental overhead
* ✅ Free tier only
* ✅ No servers / no Express
* ✅ Rotate secrets in ONE place
* ✅ Simple + boring (good)

---

## 🧠 High‑level flow (remember this first)

1. **Cloudflare Worker** securely stores the real secret (`GITLAB_TOKEN`)
2. Each GitHub repo stores **one permanent secret** (`ACCESS_KEY`)
3. GitHub Actions sends a **POST request** to the Worker
4. Worker:

   * validates `ACCESS_KEY`
   * validates timestamp (anti‑replay)
   * returns the GitLab token
5. Workflow uses the token and forgets it

> 🔁 When the GitLab token expires → update **only Cloudflare**, nothing else.

---

## ☁️ Cloudflare Setup (ONE‑TIME)

### Worker URL

```
https://keymanagement.joeljollyhere.workers.dev
```

### Required Secrets (Worker → Settings → Variables → **Secrets**)

| Name           | Purpose                                     |
| -------------- | ------------------------------------------- |
| `ACCESS_KEY`   | Permanent shared key used by GitHub Actions |
| `GITLAB_TOKEN` | Real GitLab Personal Access Token           |

⚠️ These **must** be added as **Secrets**, not Variables.

After changing secrets → **Redeploy** the Worker.

---

## 🧩 Worker API Contract

### Request

* **Method:** `POST`
* **Content‑Type:** `application/json`

```json
{
  "accessKey": "<ACCESS_KEY>",
  "ts": 1735030000000
}
```

### Rules

* `accessKey` must match Cloudflare `ACCESS_KEY`
* `ts` must be within **±5 minutes** of current time
* GET requests are rejected

### Response

```
<gitlab-token>
```

---

## 📦 Worker Logic (What it does)

* Rejects non‑POST requests
* Validates JSON body
* Authenticates using `ACCESS_KEY`
* Blocks replay attacks using timestamp
* Logs **only events**, never secrets
* Returns `GITLAB_TOKEN`

---

## 🧾 Logging (Safe by design)

The Worker logs:

* auth failures
* replay blocks
* successful token issues

It **never logs**:

* access keys
* tokens
* request bodies

---

## 🐙 GitHub Repo Setup (PER REPO, ONE‑TIME)

Each repo needs **exactly one secret**:

```
ACCESS_KEY = <same value as Cloudflare ACCESS_KEY>
```

You will **never rotate this unless compromised**.

---

## 🤖 GitHub Actions Usage

### Example workflow snippet

```yaml
- name: Fetch GitLab token
  run: |
    TS=$(date +%s%3N)
    TOKEN=$(curl -s -X POST https://keymanagement.joeljollyhere.workers.dev \
      -H "Content-Type: application/json" \
      -d "{
        \"accessKey\": \"${{ secrets.ACCESS_KEY }}\",
        \"ts\": $TS
      }")

    if [ -z "$TOKEN" ]; then
      echo "Failed to fetch GitLab token"
      exit 1
    fi

    echo "GITLAB_TOKEN=$TOKEN" >> $GITHUB_ENV
```

Then use it normally:

```bash
git remote add gitlab https://oauth2:${GITLAB_TOKEN}@gitlab.com/withinjoel/<repo>.git
git push gitlab main --force
```

---

## 🔁 Rotation Policy (IMPORTANT)

### Rotate GitLab token

1. Cloudflare → Worker → Settings → Variables
2. Update `GITLAB_TOKEN`
3. Redeploy

✅ No repo changes

### Rotate ACCESS_KEY (only if leaked)

1. Generate new key
2. Update in Cloudflare
3. Update in each GitHub repo

---

## 🚫 Things NOT to do

* ❌ Do not store GitLab token in GitHub repos
* ❌ Do not log tokens
* ❌ Do not expose Worker URL publicly
* ❌ Do not use GET requests
* ❌ Do not commit secrets anywhere

---

## 🧘 Why this architecture was chosen

* GitHub Org secrets were not an option
* Per‑repo rotation was unacceptable
* Free tier only
* Needed something that future‑me won’t forget

This Worker is intentionally **simple and boring**.

---

## 🧠 One‑line reminder for future you

> "GitHub repos only know ACCESS_KEY. Cloudflare knows the real secret. Rotate there."

---

## ✅ Status

* [x] Worker deployed
* [x] Secrets stored securely
* [x] POST + timestamp protection
* [x] Repo workflows wired
* [x] Problem solved

---

## YML file to be placed in your repo
* location in your `github` repo `.github/workflows/Backup to Gitlab.yml`
```
name: Backup to GitLab

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  backup:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Compute repo names
        run: |
          REPO_DISPLAY_NAME="${GITHUB_REPOSITORY#*/}"
          REPO_PATH=$(echo "$REPO_DISPLAY_NAME" | tr '[:upper:]' '[:lower:]')

          echo "REPO_DISPLAY_NAME=$REPO_DISPLAY_NAME" >> $GITHUB_ENV
          echo "REPO_PATH=$REPO_PATH" >> $GITHUB_ENV

      - name: Fetch GitLab token from KeyManagement
        run: |
          TS=$(date +%s%3N)
          TOKEN=$(curl -s -X POST https://keymanagement.joeljollyhere.workers.dev \
            -H "Content-Type: application/json" \
            -d "{
              \"accessKey\": \"${{ secrets.ACCESS_KEY }}\",
              \"key\": \"gitlab\",
              \"ts\": $TS
            }")

          if [ -z "$TOKEN" ]; then
            echo "Failed to fetch GitLab token"
            exit 1
          fi

          echo "GITLAB_TOKEN=$TOKEN" >> $GITHUB_ENV

      - name: Ensure GitLab repo exists
        run: |
          PROJECT_PATH="withinjoel/${REPO_PATH}"
          ENCODED_PATH=$(echo "$PROJECT_PATH" | sed 's/\//%2F/g')

          STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
            -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
            "https://gitlab.com/api/v4/projects/${ENCODED_PATH}")

          if [ "$STATUS" = "404" ]; then
            echo "GitLab repo does not exist. Creating..."

            USER_ID=$(curl -s \
              -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
              https://gitlab.com/api/v4/user | jq '.id')

            curl -s -X POST https://gitlab.com/api/v4/projects \
              -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
              -H "Content-Type: application/json" \
              -d "{
                \"name\": \"${REPO_DISPLAY_NAME}\",
                \"path\": \"${REPO_PATH}\",
                \"namespace_id\": ${USER_ID},
                \"visibility\": \"private\"
              }"
          else
            echo "GitLab repo already exists."
          fi

      - name: Push to GitLab
        run: |
          git config --global user.name "GitHub Backup Bot"
          git config --global user.email "bot@example.com"

          git remote add gitlab \
            https://oauth2:${GITLAB_TOKEN}@gitlab.com/withinjoel/${REPO_PATH}.git

          git push gitlab main --force
```
---

## Key
* `URL`: `https://keymanagement.joeljollyhere.workers.dev/?accessKey=<YourAccessKey&key=<KeyName>`
* `ACCESS_KEY`: `jKJHhfsHAGljgasgLGAG62gkgYh543hUIS671kja6542JHGjha8718b817`

---

You can now safely forget how this works — this README exists for that reason 😄
