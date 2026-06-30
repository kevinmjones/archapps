#!/usr/bin/env bash
# Post the report-distribution Mastodon thread (3 statuses).
# Required env vars:
#   MASTODON_INSTANCE_URL  — e.g. https://mastodon.social
#   MASTODON_ACCESS_TOKEN  — scope: write:statuses
# Usage:
#   ./scripts/post-mastodon.sh          # live post
#   DRY_RUN=1 ./scripts/post-mastodon.sh  # print payloads, no network

set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"

if [[ "$DRY_RUN" != "1" ]]; then
  : "${MASTODON_INSTANCE_URL:?'MASTODON_INSTANCE_URL env var is required'}"
  : "${MASTODON_ACCESS_TOKEN:?'MASTODON_ACCESS_TOKEN env var is required'}"
fi

INSTANCE_URL="${MASTODON_INSTANCE_URL:-https://mastodon.example}"
TOKEN="${MASTODON_ACCESS_TOKEN:-DRY_RUN_TOKEN}"
API_BASE="${INSTANCE_URL%/}/api/v1/statuses"

# ── Approved copy (from marketing-content/20-report-distribution.md) ────────

POST1='"Anonymous" is a marketing word, not a math guarantee.

87% of Americans are unique on {ZIP, gender, birth date}. Four time-stamped location points re-identify 95% of people.

The location data your apps leak is exactly that kind of data. New report, every claim sourced. 🧵

archapps.dev/blog/posts/unknown-data-apps-steal.html'

POST2='Why now? AI changes the half-life of leaked data.

Once your data is in a model'\''s weights, there'\''s no "delete." Re-identification defeats anonymization. Raw location exhaust becomes health/religion/immigration inferences at broker scale.

Old data you "anonymously" leaked doesn'\''t stay anonymous.'

POST3='Our conclusion, stated plainly: the only data that can'\''t be trained on, inferred from, re-identified, breached, or subpoenaed is the data that was never collected.

That'\''s the whole argument for offline-first software. Sources in the report — check our work.

#Privacy #AI #OpenSource'

post_status() {
  local status="$1"
  local reply_to="${2:-}"
  local payload
  payload=$(jq -n \
    --arg status "$status" \
    --arg reply_to "$reply_to" \
    '{status: $status} + (if $reply_to != "" then {in_reply_to_id: $reply_to} else {} end)')

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "=== DRY-RUN: POST ${API_BASE} ===" >&2
    echo "Authorization: Bearer ${TOKEN}" >&2
    echo "Payload:" >&2
    echo "$payload" | jq . >&2
    echo "" >&2
    # Return a stable fake ID for threading (stdout only)
    echo "DRY_RUN_ID_PLACEHOLDER"
    return
  fi

  curl -sS -X POST "$API_BASE" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$payload" | jq -r '.id'
}

echo "=== Mastodon thread: Post 1/3 ==="
ID1=$(post_status "$POST1")
echo "  → status id: $ID1"

echo "=== Mastodon thread: Post 2/3 (reply to $ID1) ==="
ID2=$(post_status "$POST2" "$ID1")
echo "  → status id: $ID2"

echo "=== Mastodon thread: Post 3/3 (reply to $ID2) ==="
ID3=$(post_status "$POST3" "$ID2")
echo "  → status id: $ID3"

echo ""
echo "Done. Thread root: ${INSTANCE_URL}/@\$(whoami)/${ID1}"
