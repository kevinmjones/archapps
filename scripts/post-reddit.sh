#!/usr/bin/env bash
# Submit the report-distribution post to r/privacy (text post + link-in-first-comment).
# Required env vars:
#   REDDIT_CLIENT_ID      — OAuth2 app client ID
#   REDDIT_CLIENT_SECRET  — OAuth2 app client secret
#   REDDIT_REFRESH_TOKEN  — long-lived refresh token (scope: submit)
#   REDDIT_USERNAME       — account username (no u/ prefix)
# Usage:
#   ./scripts/post-reddit.sh             # live post
#   DRY_RUN=1 ./scripts/post-reddit.sh  # print payloads, no network

set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"

if [[ "$DRY_RUN" != "1" ]]; then
  : "${REDDIT_CLIENT_ID:?'REDDIT_CLIENT_ID env var is required'}"
  : "${REDDIT_CLIENT_SECRET:?'REDDIT_CLIENT_SECRET env var is required'}"
  : "${REDDIT_REFRESH_TOKEN:?'REDDIT_REFRESH_TOKEN env var is required'}"
  : "${REDDIT_USERNAME:?'REDDIT_USERNAME env var is required'}"
fi

CLIENT_ID="${REDDIT_CLIENT_ID:-DRY_CLIENT_ID}"
CLIENT_SECRET="${REDDIT_CLIENT_SECRET:-DRY_SECRET}"
REFRESH_TOKEN="${REDDIT_REFRESH_TOKEN:-DRY_REFRESH}"
REDDIT_USERNAME="${REDDIT_USERNAME:-archapps_bot}"
SUBREDDIT="privacy"

REPORT_URL="https://archapps.dev/blog/posts/unknown-data-apps-steal.html"

# ── Approved copy (from marketing-content/20-report-distribution.md) ────────

POST_TITLE="New sourced report: the unknown data your apps steal, and why AI raises the stakes"

POST_BODY='I put together a report on what mobile apps actually collect — period trackers sharing pregnancy status, "family safety" apps selling location to brokers, the famous flashlight app that leaked location before you tapped anything — and then on why the AI era makes it worse: training data with no delete, re-identification that defeats "anonymized," inference at scale.

I tried to do this the honest way: every claim is tied to a named source (FTC orders, court filings, peer-reviewed re-identification research), and I explicitly list the commonly-repeated claims I *won'\''t* make because they'\''re not supported (e.g. there'\''s no known prosecution using menstrual-app data — it'\''s a documented risk, not a recorded incident).

Full disclosure: I build privacy-first apps, so I have a bias. That'\''s why it'\''s all sourced — verify it, don'\''t trust it. Link in comments. What did I get wrong?'

FIRST_COMMENT="Full report: ${REPORT_URL}"

# ── Token exchange ───────────────────────────────────────────────────────────

get_access_token() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY_RUN_ACCESS_TOKEN"
    return
  fi

  curl -sS -X POST "https://www.reddit.com/api/v1/access_token" \
    --user "${CLIENT_ID}:${CLIENT_SECRET}" \
    -H "User-Agent: archapps-distro-bot/1.0 (by /u/${REDDIT_USERNAME})" \
    -d "grant_type=refresh_token&refresh_token=${REFRESH_TOKEN}" \
    | jq -r '.access_token'
}

# ── Submit post ──────────────────────────────────────────────────────────────

submit_post() {
  local access_token="$1"
  local submit_payload
  submit_payload=$(jq -n \
    --arg sr "$SUBREDDIT" \
    --arg title "$POST_TITLE" \
    --arg text "$POST_BODY" \
    '{
      api_type: "json",
      kind: "self",
      sr: $sr,
      title: $title,
      text: $text,
      resubmit: true,
      nsfw: false,
      spoiler: false
    }')

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "=== DRY-RUN: POST https://oauth.reddit.com/api/submit ===" >&2
    echo "Authorization: Bearer ${access_token}" >&2
    echo "Payload:" >&2
    echo "$submit_payload" | jq . >&2
    echo "" >&2
    echo "DRY_RUN_POST_ID"
    return
  fi

  curl -sS -X POST "https://oauth.reddit.com/api/submit" \
    -H "Authorization: Bearer ${access_token}" \
    -H "User-Agent: archapps-distro-bot/1.0 (by /u/${REDDIT_USERNAME})" \
    -H "Content-Type: application/json" \
    -d "$submit_payload" | jq -r '.json.data.id'
}

# ── Post first comment (link-in-first-comment etiquette) ────────────────────

post_comment() {
  local access_token="$1"
  local thing_id="$2"   # e.g. t3_<post_id>
  local comment_payload
  comment_payload=$(jq -n \
    --arg thing_id "$thing_id" \
    --arg text "$FIRST_COMMENT" \
    '{api_type: "json", thing_id: $thing_id, text: $text}')

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "=== DRY-RUN: POST https://oauth.reddit.com/api/comment ===" >&2
    echo "Authorization: Bearer ${access_token}" >&2
    echo "Payload:" >&2
    echo "$comment_payload" | jq . >&2
    echo "" >&2
    echo "DRY_RUN_COMMENT_ID"
    return
  fi

  curl -sS -X POST "https://oauth.reddit.com/api/comment" \
    -H "Authorization: Bearer ${access_token}" \
    -H "User-Agent: archapps-distro-bot/1.0 (by /u/${REDDIT_USERNAME})" \
    -H "Content-Type: application/json" \
    -d "$comment_payload" | jq -r '.json.data.things[0].data.id'
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo "=== Reddit distribution: r/${SUBREDDIT} ==="

echo "--- Step 1: acquire access token ---"
ACCESS_TOKEN=$(get_access_token)
echo "  → token acquired: ${ACCESS_TOKEN:0:8}..."

echo "--- Step 2: submit text post ---"
POST_ID=$(submit_post "$ACCESS_TOKEN")
echo "  → post id: $POST_ID"

echo "--- Step 3: post link in first comment ---"
THING_ID="t3_${POST_ID}"
COMMENT_ID=$(post_comment "$ACCESS_TOKEN" "$THING_ID")
echo "  → comment id: $COMMENT_ID"

echo ""
echo "Done. Post: https://www.reddit.com/r/${SUBREDDIT}/comments/${POST_ID}/"
