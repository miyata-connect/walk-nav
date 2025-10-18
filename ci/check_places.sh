#!/usr/bin/env bash
set -euo pipefail

URL="https://ors-proxy.miyata-connect-jp.workers.dev/places"
PAYLOAD='{"text":"徳島駅 コンビニ","limit":5,"lang":"ja","lat":34.07324,"lng":134.55066,"radius":1200}'

resp="$(curl -sS -X POST "$URL" -H "Content-Type: application/json" --data-binary "$PAYLOAD")" || {
  echo "NG: request failed"
  exit 1
}

# jq が無い環境でも動く最小判定
if echo "$resp" | grep -q '"places":'; then
  echo "OK"
  exit 0
else
  echo "NG"
  echo "$resp"
  exit 1
fi
