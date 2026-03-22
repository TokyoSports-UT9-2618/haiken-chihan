#!/usr/bin/env node
/**
 * download-boundaries.js
 * dataofjapan/land の japan.geojson (MLIT行政区域データ) を1回ダウンロードし、
 * 都道府県別に分割してboundaries.geojsonを生成する。
 *
 * 使い方:
 *   node scripts/download-boundaries.js           # 全47都道府県
 *   node scripts/download-boundaries.js 04 07     # 指定県のみ
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const JAPAN_GEOJSON_URL = 'https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson';
const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, '_japan_cache.geojson');

// dataofjapaのfeatureから市区町村フルネームを構築
function getFeatureName(props) {
  if (props.ward_ja) return props.ward_ja;
  // N03_004 が市区町村名のことが多い（例: "福島市", "青葉区"）
  // 政令市の区は N03_003, 市名は N03_002
  const city   = props.N03_004 || '';
  const ward   = props.N03_003 || '';
  const county = props.N03_002 || '';
  if (city) return city;
  if (county && ward) return county + ward;
  return county || '';
}

function getFeatureCode(props) {
  const raw = String(props.N03_007 || '').replace(/\D/g, '');
  if (!raw) return '';
  if (raw.length === 6) return raw.slice(0, 5);
  return raw.padStart(5, '0');
}

// 内部リング除去 + 極小サブポリゴン除去
function cleanGeometry(feature) {
  const geom = feature.geometry;
  if (!geom) return feature;

  if (geom.type === 'Polygon') {
    if (geom.coordinates.length > 1) geom.coordinates = [geom.coordinates[0]];
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates = geom.coordinates
      .map(poly => [poly[0]])
      .filter(poly => {
        const ring = poly[0];
        const lngs = ring.map(p => p[0]);
        const lats  = ring.map(p => p[1]);
        return (Math.max(...lngs) - Math.min(...lngs)) * (Math.max(...lats) - Math.min(...lats)) >= 0.000001;
      });
    if (geom.coordinates.length === 1) {
      feature.geometry = { type: 'Polygon', coordinates: geom.coordinates[0] };
    }
  }
  return feature;
}

async function downloadJapanGeoJSON() {
  if (fs.existsSync(CACHE_FILE)) {
    console.log('  キャッシュを使用: _japan_cache.geojson');
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
  console.log(`  ダウンロード中 (約13MB): ${JAPAN_GEOJSON_URL}`);
  const res = await fetch(JAPAN_GEOJSON_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  console.log(`  ダウンロード完了: ${data.features.length} features`);
  return data;
}

function processPref(prefCode, japanData) {
  const muniFile = path.join(DATA_DIR, prefCode, 'municipalities.json');
  if (!fs.existsSync(muniFile)) {
    console.warn(`  SKIP ${prefCode}: municipalities.json なし`);
    return false;
  }
  const munis = JSON.parse(fs.readFileSync(muniFile, 'utf8'));
  const muniByName = new Map(munis.map(m => [m.name, m]));
  const muniByCode = new Map(munis.map(m => [m.code, m]));

  // この都道府県のfeatureだけ抽出
  const prefFeatures = japanData.features.filter(f => {
    const code = getFeatureCode(f.properties);
    return code.startsWith(prefCode);
  });

  if (prefFeatures.length === 0) {
    console.warn(`  [${prefCode}] featureが見つかりません`);
    return false;
  }

  // 市区町村ごとにグループ化
  const groups = new Map();
  for (const feature of prefFeatures) {
    if (!feature.geometry) continue;
    const featureName = getFeatureName(feature.properties);
    const featureCode = getFeatureCode(feature.properties);

    let muni = muniByName.get(featureName);
    if (!muni && featureCode) muni = muniByCode.get(featureCode);
    if (!muni) continue;

    if (!groups.has(muni.code)) groups.set(muni.code, { muni, features: [] });
    groups.get(muni.code).features.push(feature);
  }

  // 各市区町村のポリゴンを統合
  const outputFeatures = [];
  for (const { muni, features } of groups.values()) {
    let merged;
    if (features.length === 1) {
      merged = { ...features[0] };
    } else {
      try {
        merged = features.reduce((acc, f) => turf.union(acc, f));
      } catch (e) {
        const allCoords = [];
        for (const f of features) {
          const g = f.geometry;
          if (g.type === 'Polygon') allCoords.push(g.coordinates);
          else if (g.type === 'MultiPolygon') allCoords.push(...g.coordinates);
        }
        merged = turf.feature(
          allCoords.length === 1
            ? { type: 'Polygon', coordinates: allCoords[0] }
            : { type: 'MultiPolygon', coordinates: allCoords }
        );
      }
    }

    // 座標間引き
    let simplified;
    try {
      simplified = turf.simplify(merged, { tolerance: 0.0001, highQuality: false });
    } catch (e) {
      simplified = merged;
    }

    cleanGeometry(simplified);
    simplified.properties = { code: muni.code, name: muni.name, pop: muni.pop };
    outputFeatures.push(simplified);
  }

  const matched = new Set(outputFeatures.map(f => f.properties.code));
  const unmatched = munis.filter(m => !matched.has(m.code));
  if (unmatched.length > 0) {
    console.warn(`  [${prefCode}] 未マッチ(${unmatched.length}件): ${unmatched.map(m => m.name).join(', ')}`);
  }

  const outFile = path.join(DATA_DIR, prefCode, 'boundaries.geojson');
  fs.writeFileSync(outFile, JSON.stringify({ type: 'FeatureCollection', features: outputFeatures }));
  const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
  console.log(`  [${prefCode}] 完了: ${outputFeatures.length}/${munis.length} 市区町村, ${kb}KB`);
  return true;
}

async function main() {
  const args = process.argv.slice(2).filter(a => /^\d{2}$/.test(a));
  const allCodes = Array.from({length: 47}, (_, i) => String(i + 1).padStart(2, '0'));
  const targets = args.length > 0 ? args.map(a => a.padStart(2, '0')) : allCodes;

  console.log(`\n=== dataofjapan boundaries 生成開始 (${targets.length}県) ===\n`);

  const japanData = await downloadJapanGeoJSON();

  const results = { ok: [], fail: [] };
  for (const code of targets) {
    const ok = processPref(code, japanData);
    (ok ? results.ok : results.fail).push(code);
  }

  console.log(`\n=== 完了 ===`);
  console.log(`成功: ${results.ok.length}件`);
  if (results.fail.length > 0) {
    console.log(`失敗/スキップ: ${results.fail.join(',')}`);
  }

  // キャッシュは不要なら削除してもよい
  // fs.unlinkSync(CACHE_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
