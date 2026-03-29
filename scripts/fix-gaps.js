#!/usr/bin/env node
/**
 * fix-gaps.js
 * boundaries.geojson のポリゴン間の隙間（gap）を解消する。
 *
 * 方法:
 * 1. 全ポリゴンをunionして県全体の外殻を得る（バッファ付き）
 * 2. 外殻と各ポリゴンの差分（隙間部分）を抽出
 * 3. 各隙間ピクセルを最寄りの市区町村に割り当てる
 *
 * → 実際にはシンプルに「各ポリゴンを少し膨らませ、隣接ポリゴンで
 *   クリップしない（重なりOK）」方式が Leaflet 表示では最も自然。
 *   バッファ + 元の形を残すため、元ポリゴンの全座標を保持しつつ
 *   外側に膨張させる。
 *
 * 改善版: 2段階バッファ（膨張→収縮 = morphological closing）
 *   +3km → -2.5km = 実質+500m膨張だが、隙間は3kmまで埋まる
 *
 * 使い方:
 *   node scripts/fix-gaps.js 04          # 宮城のみ
 *   node scripts/fix-gaps.js --all       # 全県
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const EXPAND_KM  = 3.0;  // 膨張
const SHRINK_KM  = 2.5;  // 収縮（差分が実質膨張量）

function stripHoles(feature) {
  const geom = feature.geometry;
  if (!geom) return;
  if (geom.type === 'Polygon') {
    geom.coordinates = [geom.coordinates[0]];
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates = geom.coordinates.map(poly => [poly[0]]);
  }
}

function removeSmallParts(feature, minAreaM2) {
  const geom = feature.geometry;
  if (!geom || geom.type !== 'MultiPolygon') return;
  const kept = geom.coordinates.filter(poly => {
    try { return turf.area(turf.polygon(poly)) >= minAreaM2; } catch(e) { return true; }
  });
  if (kept.length === 0) return;
  if (kept.length === 1) {
    geom.type = 'Polygon';
    geom.coordinates = kept[0];
  } else {
    geom.coordinates = kept;
  }
}

function fixFeature(feature) {
  try {
    // Step 1: buffer(0) で自己交差を修復
    let fixed = turf.buffer(feature, 0, { units: 'kilometers' });
    if (!fixed || !fixed.geometry) fixed = feature;

    // Step 2: morphological closing（膨張→収縮）で隙間を埋めつつ形を保つ
    let expanded = turf.buffer(fixed, EXPAND_KM, { units: 'kilometers' });
    if (!expanded || !expanded.geometry) return feature;

    let closed = turf.buffer(expanded, -SHRINK_KM, { units: 'kilometers' });
    if (!closed || !closed.geometry) return feature;

    // Step 3: 穴を除去
    stripHoles(closed);

    // Step 4: 極小サブポリゴン除去
    removeSmallParts(closed, 100000); // 0.1km²未満

    // Step 5: simplify（控えめに）
    let simplified = turf.simplify(closed, { tolerance: 0.0002, highQuality: true });
    if (!simplified || !simplified.geometry) simplified = closed;

    simplified.properties = feature.properties;
    return simplified;
  } catch (e) {
    console.error(`  ⚠️ ${feature.properties?.name}: ${e.message}`);
    return feature;
  }
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
  console.error('使い方: node scripts/fix-gaps.js <県コード...> | --all');
  process.exit(1);
}

for (const pc of prefCodes) {
  const geojsonPath = path.join(__dirname, '..', 'data', pc, 'boundaries.geojson');

  if (!fs.existsSync(geojsonPath)) {
    console.log(`⚠️  ${pc}: boundaries.geojson が見つかりません、スキップ`);
    continue;
  }

  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  const origSize = fs.statSync(geojsonPath).size;

  let fixed = 0;
  for (let i = 0; i < geojson.features.length; i++) {
    const orig = geojson.features[i];
    const result = fixFeature(orig);
    if (result !== orig) {
      geojson.features[i] = result;
      fixed++;
    }
  }

  let totalArea = 0;
  for (const f of geojson.features) {
    try { totalArea += turf.area(f); } catch(e) {}
  }

  fs.writeFileSync(geojsonPath, JSON.stringify(geojson), 'utf8');
  const newSize = fs.statSync(geojsonPath).size;

  console.log(`✅ ${pc}: ${fixed}/${geojson.features.length} fixed, ${(totalArea/1e6).toFixed(0)}km², ${(origSize/1024).toFixed(0)}KB → ${(newSize/1024).toFixed(0)}KB`);
}
