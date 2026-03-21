#!/usr/bin/env node
/**
 * verify.js
 * 生成されたデータの品質チェック。
 *
 * 使い方:
 *   node scripts/verify.js 07          # 福島県のチェック
 *   node scripts/verify.js 07 --adj    # 隣接リストの詳細表示
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const prefCode = (process.argv[2] || '07').padStart(2, '0');
const showAdj  = process.argv.includes('--adj');

const dataDir  = path.join(__dirname, '..', 'data', prefCode);
const muniPath = path.join(dataDir, 'municipalities.json');
const adjPath  = path.join(dataDir, 'adjacency.json');

if (!fs.existsSync(muniPath)) {
  console.error(`データが見つかりません: ${muniPath}`);
  process.exit(1);
}

const munis = JSON.parse(fs.readFileSync(muniPath, 'utf8'));
const pairs = JSON.parse(fs.readFileSync(adjPath, 'utf8'));

// 隣接リストをルックアップ形式に変換
const adjMap = {};
for (const pair of pairs) {
  const [a, b] = pair.split('_');
  (adjMap[a] = adjMap[a] || []).push(b);
  (adjMap[b] = adjMap[b] || []).push(a);
}

console.log(`\n=== 検証レポート: ${prefCode} ===\n`);

// 基本統計
const totalPop = munis.reduce((s, m) => s + m.pop, 0);
const totalTax = munis.reduce((s, m) => s + m.taxRevenue, 0);
console.log(`市区町村数:     ${munis.length}`);
console.log(`総人口:         ${totalPop.toLocaleString()}人`);
console.log(`総税収:         約${(totalTax/1e8).toFixed(1)}億円`);
console.log(`隣接ペア数:     ${pairs.length}`);

// 人口ゼロ
const zeroPop = munis.filter(m => m.pop === 0);
if (zeroPop.length > 0) {
  console.log(`\n⚠️  人口ゼロ: ${zeroPop.map(m => m.name).join(', ')}`);
}

// 税収ゼロ
const zeroTax = munis.filter(m => m.taxRevenue === 0);
if (zeroTax.length > 0) {
  console.log(`⚠️  税収ゼロ: ${zeroTax.map(m => m.name).join(', ')}`);
}

// 孤立市区町村（隣接なし）
const isolated = munis.filter(m => !(adjMap[m.code] && adjMap[m.code].length > 0));
console.log(`\n孤立市区町村（隣接なし）: ${isolated.length}件`);
isolated.forEach(m => console.log(`  - ${m.name} (${m.code}) 人口:${m.pop.toLocaleString()}`));

// 隣接数の統計
const adjCounts = munis.map(m => (adjMap[m.code] || []).length);
const avgAdj    = (adjCounts.reduce((s, n) => s + n, 0) / adjCounts.length).toFixed(1);
const maxAdj    = Math.max(...adjCounts);
const minAdj    = Math.min(...adjCounts);
console.log(`\n隣接数: 平均${avgAdj}, 最大${maxAdj}, 最小${minAdj}`);

if (showAdj) {
  console.log('\n=== 隣接リスト詳細 ===');
  munis.forEach(m => {
    const neighbors = (adjMap[m.code] || [])
      .map(c => munis.find(x => x.code === c)?.name || c)
      .join(', ');
    console.log(`  ${m.name}: [${neighbors}]`);
  });
}

// 座標チェック
const badCoords = munis.filter(m => m.lat === 0 || m.lng === 0 || isNaN(m.lat) || isNaN(m.lng));
if (badCoords.length > 0) {
  console.log(`\n⚠️  座標不正: ${badCoords.map(m => m.name).join(', ')}`);
}

console.log('\n=== 完了 ===\n');
