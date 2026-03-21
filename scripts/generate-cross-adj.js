#!/usr/bin/env node
/**
 * generate-cross-adj.js
 * 隣接する2つの都道府県の境界をまたぐ市区町村ペアを計算し
 * data/cross/{A}_{B}.json に出力する。
 *
 * 使い方:
 *   node scripts/generate-cross-adj.js 04 07   # 宮城-福島の県境ペア
 *   node scripts/generate-cross-adj.js --all   # 全隣接ペアを一括処理
 */

'use strict';

const fetch     = require('node-fetch');
const shapefile = require('shapefile');
const JSZip     = require('jszip');
const turf      = require('@turf/turf');
const fs        = require('fs');
const path      = require('path');

// 県境は精度が荒い場合があるため、県内より大きい許容誤差
const ADJ_TOLERANCE = 0.003;
const ADJ_MIN_SHARED = 2;

const ESTAT_SURVEY_ID = 'A002005212020';

// 47都道府県の陸上隣接ペア（昇順コードで記載）
const ADJACENT_PREF_PAIRS = [
  ['01','02'],['01','03'],
  ['02','03'],['02','05'],
  ['03','04'],['03','05'],
  ['04','06'],['04','07'],
  ['05','06'],
  ['06','07'],['06','15'],
  ['07','08'],['07','09'],['07','14'],['07','15'],
  ['08','09'],['08','11'],['08','12'],
  ['09','10'],['09','11'],
  ['10','11'],['10','15'],['10','20'],
  ['11','12'],['11','13'],['11','14'],['11','20'],
  ['12','13'],['12','14'],
  ['13','14'],['13','19'],
  ['14','19'],['14','22'],
  ['15','16'],['15','20'],
  ['16','17'],['16','20'],['16','21'],
  ['17','18'],['17','20'],['17','21'],
  ['18','21'],['18','26'],
  ['19','20'],['19','22'],['19','13'],
  ['20','15'],['20','16'],['20','17'],['20','19'],['20','21'],['20','22'],
  ['21','22'],['21','23'],['21','24'],['21','25'],['21','26'],
  ['22','23'],['22','19'],
  ['23','24'],['23','25'],['23','26'],
  ['24','25'],['24','26'],['24','29'],['24','30'],
  ['25','26'],['25','27'],['25','28'],['25','29'],
  ['26','27'],['26','28'],['26','29'],
  ['27','28'],['27','29'],['27','30'],
  ['28','29'],['28','31'],['28','33'],['28','34'],
  ['29','27'],['29','24'],['29','30'],
  ['30','24'],
  ['31','32'],['31','33'],['31','35'],
  ['32','33'],['32','34'],['32','35'],
  ['33','34'],['33','35'],['33','37'],
  ['34','35'],['34','38'],['34','39'],
  ['35','38'],
  ['36','37'],['36','38'],['36','39'],
  ['37','38'],['37','39'],
  ['38','39'],['38','40'],
  ['39','40'],
  ['40','41'],['40','42'],['40','43'],['40','44'],
  ['41','42'],['41','43'],
  ['42','43'],['42','44'],['42','46'],
  ['43','44'],['43','45'],['43','46'],
  ['44','45'],['44','46'],
  ['45','46'],
];

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--all')) {
    console.log(`全 ${ADJACENT_PREF_PAIRS.length} 県境ペアを処理します\n`);
    for (const [a, b] of ADJACENT_PREF_PAIRS) {
      await processPair(a, b);
    }
    return;
  }

  const prefCodes = args.filter(a => /^\d{2}$/.test(a));
  if (prefCodes.length !== 2) {
    console.error('使い方: node scripts/generate-cross-adj.js <県コードA> <県コードB>');
    process.exit(1);
  }

  const [a, b] = prefCodes.map(c => c.padStart(2, '0')).sort();
  await processPair(a, b);
}

async function processPair(prefA, prefB) {
  console.log(`\n=== 県境隣接: ${prefA} × ${prefB} ===`);

  // 両県のシェープファイルを並行取得
  let featuresA, featuresB;
  try {
    [featuresA, featuresB] = await Promise.all([
      fetchShapefile(prefA),
      fetchShapefile(prefB),
    ]);
  } catch(e) {
    console.error(`  ❌ 取得失敗: ${e.message}`);
    return;
  }

  // 市区町村単位に座標を集約（小地域ポリゴンをそのまま使用）
  const cityMapA = aggregateCityRaw(featuresA, prefA);
  const cityMapB = aggregateCityRaw(featuresB, prefB);
  console.log(`  ${prefA}: ${Object.keys(cityMapA).length}市区町村, ${prefB}: ${Object.keys(cityMapB).length}市区町村`);

  // 座標ハッシュマップ方式で県境ペアを検出
  // A県の座標 → cityCode をインデックス化し、B県の座標と照合
  const coordIndex = new Map(); // key → Set of prefA cityCodes
  for (const [code, coords] of Object.entries(cityMapA)) {
    for (const [x, y] of coords) {
      const key = `${x.toFixed(4)},${y.toFixed(4)}`;
      if (!coordIndex.has(key)) coordIndex.set(key, new Set());
      coordIndex.get(key).add(code);
    }
  }

  // B県の座標でA県インデックスを検索し共有カウント
  const pairCount = new Map();
  for (const [codeB, coordsB] of Object.entries(cityMapB)) {
    for (const [x, y] of coordsB) {
      const key = `${x.toFixed(4)},${y.toFixed(4)}`;
      const codesA = coordIndex.get(key);
      if (!codesA) continue;
      for (const codeA of codesA) {
        const pairKey = [codeA, codeB].sort().join('_');
        pairCount.set(pairKey, (pairCount.get(pairKey) || 0) + 1);
      }
    }
  }

  const pairs = [...pairCount.entries()]
    .filter(([, count]) => count >= ADJ_MIN_SHARED)
    .map(([key]) => key);

  console.log(`  → ${pairs.length} 県境隣接ペア`);

  const outDir = path.join(__dirname, '..', 'data', 'cross');
  fs.mkdirSync(outDir, { recursive: true });

  const fileName = `${prefA}_${prefB}.json`;
  const outPath  = path.join(outDir, fileName);
  fs.writeFileSync(outPath, JSON.stringify(pairs.sort(), null, 2), 'utf8');
  console.log(`  📁 ${outPath}`);
}

// ============================================================
// 市区町村別座標リスト集約（dissolveせず小地域ポリゴンをそのまま使用）
// ============================================================
function aggregateCityRaw(features, prefCode) {
  // fullCode → flat coordinate array
  const map = {};
  for (const f of features) {
    const props    = f.properties || {};
    const cityCode = String(props.CITY || '').trim().padStart(3, '0');
    if (!cityCode || cityCode === '000' || !f.geometry) continue;
    const fullCode = prefCode + cityCode;
    if (!map[fullCode]) map[fullCode] = [];
    collectCoords(f.geometry.coordinates, map[fullCode]);
  }
  return map;
}

function collectCoords(arr, out) {
  if (!Array.isArray(arr) || arr.length === 0) return;
  if (typeof arr[0] === 'number') { out.push(arr); return; }
  for (const item of arr) collectCoords(item, out);
}

function coordArraysAdjacent(coordsA, coordsB) {
  let shared = 0;
  for (const [ax, ay] of coordsA) {
    for (const [bx, by] of coordsB) {
      if (Math.abs(ax - bx) < ADJ_TOLERANCE && Math.abs(ay - by) < ADJ_TOLERANCE) {
        if (++shared >= ADJ_MIN_SHARED) return true;
      }
    }
  }
  return false;
}

// ============================================================
// 共通ユーティリティ
// ============================================================
async function fetchShapefile(prefCode) {
  const url = `https://www.e-stat.go.jp/gis/statmap-search/data` +
    `?dlserveyId=${ESTAT_SURVEY_ID}&code=${prefCode}&coordSys=1&format=shape&downloadType=5`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${prefCode}: ${res.status}`);

  const zipBuf = await res.buffer();
  const zip    = await JSZip.loadAsync(zipBuf);

  const shpEntry = Object.values(zip.files).find(f => f.name.endsWith('.shp'));
  const dbfEntry = Object.values(zip.files).find(f => f.name.endsWith('.dbf'));
  if (!shpEntry || !dbfEntry) throw new Error(`${prefCode}: shp/dbf not found`);

  const shpBuf = await shpEntry.async('arraybuffer');
  const dbfBuf = await dbfEntry.async('arraybuffer');

  const features = [];
  const source   = await shapefile.open(shpBuf, dbfBuf, { encoding: 'shift_jis' });
  let result;
  while (!(result = await source.read()).done) {
    features.push(result.value);
  }
  return features;
}

// coordArraysAdjacent は aggregateCityCoords の上に定義済み

main().catch(e => { console.error(e); process.exit(1); });
