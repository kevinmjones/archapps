# Report Distribution: Secret Injection Runbook

**For:** Board / operator provisioning  
**Scripts:** `scripts/post-mastodon.sh`, `scripts/post-reddit.sh`  
**Report:** [The Unknown Data Your Apps Steal](https://archapps.dev/blog/posts/unknown-data-apps-steal.html)  
**Distribution copy:** `marketing-content/20-report-distribution.md`

---

## Required secrets

### Mastodon

| Env var | Description | How to obtain |
|---|---|---|
| `MASTODON_INSTANCE_URL` | Full base URL of the instance (e.g. `https://mastodon.social`) | The instance the ArchApps account lives on |
| `MASTODON_ACCESS_TOKEN` | Personal access token with scope **`write:statuses`** | Settings → Development → New Application on your Mastodon instance; or use `/api/v1/apps` + OAuth PKCE flow |

### Reddit

| Env var | Description | How to obtain |
|---|---|---|
| `REDDIT_CLIENT_ID` | OAuth2 application Client ID | reddit.com → User Settings → Safety & Privacy → Manage third-party app permissions → create "script" type app |
| `REDDIT_CLIENT_SECRET` | OAuth2 application Client Secret | Same app settings page |
| `REDDIT_REFRESH_TOKEN` | Long-lived refresh token (scope: **`submit`**) | Complete the OAuth2 authorization code flow once with the account that will post; store the `refresh_token` from the token response |
| `REDDIT_USERNAME` | Reddit username of the posting account (no `u/` prefix) | The account that owns the OAuth2 app |

> **Token scopes:** The refresh token only needs the `submit` scope. Do not request broader scopes than necessary (Security by design — least-privilege).

---

## How to inject secrets into the Comms agent runtime

Secrets are injected as **environment variables** in the Comms agent's execution environment. The operator must provision them out-of-band; **no secret value should appear in any issue thread, commit, or config file**.

### Option A — Paperclip adapter env config (recommended)

In the Paperclip operator console, navigate to the Comms agent's adapter configuration and add the following under "Environment variables":

```
MASTODON_INSTANCE_URL=https://<your-instance>
MASTODON_ACCESS_TOKEN=<token>
REDDIT_CLIENT_ID=<id>
REDDIT_CLIENT_SECRET=<secret>
REDDIT_REFRESH_TOKEN=<refresh-token>
REDDIT_USERNAME=<username>
```

These are available to every heartbeat run for that agent and never leave the operator environment.

### Option B — GCP Secret Manager (if Comms runs on Cloud Run / GKE)

1. Store each secret in GCP Secret Manager:
   ```
   gcloud secrets create MASTODON_ACCESS_TOKEN --replication-policy=automatic
   echo -n "<token>" | gcloud secrets versions add MASTODON_ACCESS_TOKEN --data-file=-
   ```
2. Grant the Comms agent's service account `secretmanager.secretAccessor` on each secret.
3. Mount secrets as env vars in the Cloud Run service or Kubernetes pod spec.

---

## Dry-run verification (no secrets required)

Before going live, Comms can verify exact request payloads with:

```bash
DRY_RUN=1 ./scripts/post-mastodon.sh
DRY_RUN=1 ./scripts/post-reddit.sh
```

This prints the verbatim approved copy and JSON payloads with no network calls. No secrets needed in dry-run mode.

---

## Live execution

Once secrets are injected, Comms runs:

```bash
./scripts/post-mastodon.sh    # posts 3-status thread
./scripts/post-reddit.sh      # submits post + drops link in first comment
```

Both scripts are idempotent on failure (they fail fast with clear errors). Reddit's API may return a duplicate-post error if re-run within 10 minutes — safe to retry after that window.

---

## What requires operator action (cannot be done by agents)

- **Provisioning secrets** — agents cannot create or store secrets themselves; the board/operator must inject them into the adapter config or secret manager.
- **Registering the Reddit OAuth2 app** — requires a human to complete the one-time browser-based OAuth2 authorization code flow to obtain the initial refresh token.
- **Mastodon account creation** — if no account exists yet on the target instance.

---

## HN is manual (board decision)

Per [OTL-109](/OTL/issues/OTL-109) board decision: HN posting is manual, not scripted. No HN automation has been built. The approved HN copy lives in `marketing-content/20-report-distribution.md`.
