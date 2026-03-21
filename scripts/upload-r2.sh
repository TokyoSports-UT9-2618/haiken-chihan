#!/bin/bash
# R2への boundaries.geojson 一括アップロード
# 事前に: wrangler login 済み、haiken-geojson バケット作成済み

BUCKET="haiken-geojson"
DATA_DIR="$(dirname "$0")/../data"

echo "=== R2アップロード開始 ==="

for geojson in "$DATA_DIR"/*/boundaries.geojson; do
  pref=$(basename "$(dirname "$geojson")")
  remote_path="data/${pref}/boundaries.geojson"
  echo "  アップロード中: ${remote_path}"
  npx wrangler r2 object put "${BUCKET}/${remote_path}" \
    --file="$geojson" \
    --content-type="application/geo+json"
done

echo "=== 完了 ==="
