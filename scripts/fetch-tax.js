#!/usr/bin/env node
/**
 * fetch-tax.js
 * e-Stat APIから全市区町村の税収データを取得し、municipalities.jsonに書き込む。
 *
 * 使い方:
 *   node scripts/fetch-tax.js 07          # 福島のみ
 *   node scripts/fetch-tax.js --all       # 全県
 *
 * 必要: .env.local に ESTAT_APPID=xxxxx を設定
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// .env.local を読み込む
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^(\w+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

const ESTAT_APPID  = process.env.ESTAT_APPID || '';
const TAX_STATS_ID = '0003173281'; // 2018年度地方税（市区町村財政状況）

if (!ESTAT_APPID) {
  console.error('❌ ESTAT_APPID が未設定です。.env.local に設定してください');
  process.exit(1);
}

async function fetchTaxForPref(prefCode) {
  // まず県コード2桁で試す
  const url = `https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData` +
    `?appId=${ESTAT_APPID}&statsDataId=${TAX_STATS_ID}` +
    `&cdArea=${prefCode}&cdCat03=110&metaGetFlg=N&sectionHeaderFlg=1`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  HTTP ${res.status}`);
    return {};
  }

  const json = await res.json();
  const values = json?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE || [];

  if (values.length === 0) {
    // 2桁で取れなかった場合、5桁エリアコードで個別に取得
    console.log(`  ⚠️ cdArea=${prefCode} でデータなし。市区町村別に取得を試みます...`);
    return await fetchTaxByMunicipality(prefCode);
  }

  const result = {};
  for (const v of values) {
    // @area が市区町村コード(5桁)、@area_name が市区町村名
    const areaCode = (v['@area'] || '').trim();
    const areaName = (v['@area_name'] || '').trim();
    const val = Number(v['$'] || 0);
    if (val > 0) {
      if (areaCode) result[areaCode] = val * 1000; // 千円→円
      if (areaName) result[areaName] = val * 1000;
    }
  }
  return result;
}

async function fetchTaxByMunicipality(prefCode) {
  // municipalities.json から市区町村コードリストを取得
  const muniPath = path.join(__dirname, '..', 'data', prefCode, 'municipalities.json');
  if (!fs.existsSync(muniPath)) return {};

  const munis = JSON.parse(fs.readFileSync(muniPath, 'utf8'));
  const result = {};

  // バッチで取得（全市区町村のコードをカンマ区切り）
  const codes = munis.map(m => m.code);
  const batchSize = 20;

  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    const cdArea = batch.join(',');
    const url = `https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData` +
      `?appId=${ESTAT_APPID}&statsDataId=${TAX_STATS_ID}` +
      `&cdArea=${cdArea}&cdCat03=110&metaGetFlg=N&sectionHeaderFlg=1`;

    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const values = json?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE || [];
      for (const v of values) {
        const areaCode = (v['@area'] || '').trim();
        const areaName = (v['@area_name'] || '').trim();
        const val = Number(v['$'] || 0);
        if (val > 0) {
          if (areaCode) result[areaCode] = val * 1000;
          if (areaName) result[areaName] = val * 1000;
        }
      }
    } catch(e) {}

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  return result;
}

async function updatePrefTax(prefCode) {
  const muniPath = path.join(__dirname, '..', 'data', prefCode, 'municipalities.json');
  if (!fs.existsSync(muniPath)) {
    console.log(`⚠️  ${prefCode}: municipalities.json なし、スキップ`);
    return;
  }

  const munis = JSON.parse(fs.readFileSync(muniPath, 'utf8'));

  console.log(`📊 ${prefCode}: 税収データ取得中...`);
  const taxData = await fetchTaxForPref(prefCode);
  const taxKeys = Object.keys(taxData);

  if (taxKeys.length === 0) {
    console.log(`  ❌ 税収データが取得できませんでした`);
    return;
  }

  let matched = 0;
  for (const m of munis) {
    // コードマッチ → 名前マッチ の順
    const tax = taxData[m.code] || taxData[m.name] || 0;
    if (tax > 0) {
      m.taxRevenue = tax;
      matched++;
    }
  }

  fs.writeFileSync(muniPath, JSON.stringify(munis, null, 2), 'utf8');
  console.log(`✅ ${prefCode}: ${matched}/${munis.length} 市区町村に税収データを設定`);

  if (matched < munis.length) {
    const missing = munis.filter(m => !m.taxRevenue || m.taxRevenue === 0).map(m => m.name);
    if (missing.length <= 10) {
      console.log(`   未マッチ: ${missing.join(', ')}`);
    } else {
      console.log(`   未マッチ: ${missing.length}件`);
    }
  }
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
    console.error('使い方: node scripts/fetch-tax.js <県コード...> | --all');
    process.exit(1);
  }

  for (const pc of prefCodes) {
    await updatePrefTax(pc);
    // Rate limit between prefectures
    await new Promise(r => setTimeout(r, 500));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
