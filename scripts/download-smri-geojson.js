#!/usr/bin/env node
/**
 * download-smri-geojson.js
 * smartnews-smri/japan-topography から市区町村GeoJSONをダウンロードし、
 * data/XX/boundaries.geojson に変換して保存する。
 *
 * ソース: https://github.com/smartnews-smri/japan-topography
 * ライセンス: 国土数値情報の利用規約に準拠（出典表記が必要）
 *
 * 使い方:
 *   node scripts/download-smri-geojson.js 04 07    # 宮城・福島
 *   node scripts/download-smri-geojson.js --all     # 全47都道府県
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const BASE_URL = 'https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0010';

async function downloadAndConvert(prefCode) {
  const url = `${BASE_URL}/N03-21_${prefCode}_210101.json`;
  const outPath = path.join(__dirname, '..', 'data', prefCode, 'boundaries.geojson');

  // ダウンロード
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  ❌ ${prefCode}: HTTP ${res.status}`);
    return false;
  }

  const srcGeojson = await res.json();

  // プロパティを変換: N03_007 → code, N03_003+N03_004 → name
  const features = [];

  for (const f of srcGeojson.features) {
    const p = f.properties || {};
    const code = (p.N03_007 || '').trim();
    if (!code) continue;

    // 名前: 政令指定都市は「市名+区名」、それ以外は N03_004 or N03_003
    let name = '';
    const gun = (p.N03_003 || '').trim();  // 市郡名（仙台市、石巻市、etc）
    const machi = (p.N03_004 || '').trim(); // 区町村名（青葉区、etc）

    if (machi) {
      // 政令指定都市の区: gun=仙台市, machi=青葉区 → 仙台市青葉区
      if (gun && gun.endsWith('市') && machi.endsWith('区')) {
        name = gun + machi;
      } else {
        name = machi;
      }
    } else if (gun) {
      name = gun;
    }

    features.push({
      type: 'Feature',
      properties: { code, name },
      geometry: f.geometry
    });
  }

  const outGeojson = { type: 'FeatureCollection', features };

  // 出力ディレクトリ確認
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(outPath, JSON.stringify(outGeojson), 'utf8');

  const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`✅ ${prefCode}: ${features.length} features, ${sizeKB}KB → ${outPath}`);
  return true;
}

// Main
async function main() {
  const args = process.argv.slice(2);
  let prefCodes;

  if (args.includes('--all')) {
    prefCodes = [];
    for (let i = 1; i <= 47; i++) prefCodes.push(String(i).padStart(2, '0'));
  } else {
    prefCodes = args.filter(a => /^\d{2}$/.test(a));
  }

  if (prefCodes.length === 0) {
    console.error('使い方: node scripts/download-smri-geojson.js <県コード...> | --all');
    process.exit(1);
  }

  console.log(`📥 smartnews-smri/japan-topography からGeoJSONをダウンロード中...\n`);

  let success = 0;
  for (const pc of prefCodes) {
    const ok = await downloadAndConvert(pc);
    if (ok) success++;
    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n📦 完了: ${success}/${prefCodes.length} 都道府県`);
  console.log('📌 次のステップ: node scripts/rebuild-adjacency.js --all');
}

main().catch(e => { console.error(e); process.exit(1); });
