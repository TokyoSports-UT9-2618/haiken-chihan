#!/usr/bin/env node
/**
 * rebuild-adjacency.js
 * 既存の boundaries.geojson から adjacency.json を再生成する。
 * e-Stat APIキー不要。
 *
 * バッファ統合後のポリゴンは座標が完全一致しないため、
 * turf.booleanIntersects + bbox事前フィルタで隣接判定する。
 *
 * 使い方:
 *   node scripts/rebuild-adjacency.js 04 07      # 宮城・福島のみ
 *   node scripts/rebuild-adjacency.js --all       # 全県
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const turf = require('@turf/turf');

function getBBox(feature) {
  return turf.bbox(feature);
}

function bboxOverlap(a, b) {
  // [minX, minY, maxX, maxY]
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

function computeAdjacencyFromGeoJSON(geojsonPath) {
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  const features = geojson.features.filter(f => f.properties.code);

  // Precompute bboxes
  const bboxes = features.map(f => getBBox(f));

  const pairs = [];

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      // Skip if bboxes don't overlap (fast rejection)
      if (!bboxOverlap(bboxes[i], bboxes[j])) continue;

      try {
        if (turf.booleanIntersects(features[i], features[j])) {
          const a = features[i].properties.code;
          const b = features[j].properties.code;
          pairs.push(a < b ? `${a}_${b}` : `${b}_${a}`);
        }
      } catch (e) {
        // Fallback: if turf fails on complex geometry, skip
      }
    }
  }

  return pairs.sort();
}

// Main
const args = process.argv.slice(2);
let prefCodes;

if (args.includes('--all')) {
  prefCodes = [];
  for (let i = 1; i <= 47; i++) prefCodes.push(String(i).padStart(2, '0'));
} else {
  prefCodes = args.filter(a => /^\d{2}$/.test(a));
}

if (prefCodes.length === 0) {
  console.error('使い方: node scripts/rebuild-adjacency.js <県コード...> | --all');
  process.exit(1);
}

for (const pc of prefCodes) {
  const geojsonPath = path.join(__dirname, '..', 'data', pc, 'boundaries.geojson');
  const adjPath     = path.join(__dirname, '..', 'data', pc, 'adjacency.json');

  if (!fs.existsSync(geojsonPath)) {
    console.log(`⚠️  ${pc}: boundaries.geojson が見つかりません、スキップ`);
    continue;
  }

  const pairs = computeAdjacencyFromGeoJSON(geojsonPath);
  fs.writeFileSync(adjPath, JSON.stringify(pairs, null, 2), 'utf8');
  console.log(`✅ ${pc}: ${pairs.length} ペア → adjacency.json`);
}
