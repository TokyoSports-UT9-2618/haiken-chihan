#!/usr/bin/env node
/**
 * generate-all.js
 * 全47都道府県のデータを順次生成する。
 *
 * 使い方:
 *   node scripts/generate-all.js              # 全県
 *   node scripts/generate-all.js --only 04,07 # 指定県のみ
 *   node scripts/generate-all.js --skip-cross # 県境隣接をスキップ
 *   node scripts/generate-all.js --skip-tax   # 税収取得をスキップ
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ALL_PREFS = [
  '01','02','03','04','05','06','07','08','09','10',
  '11','12','13','14','15','16','17','18','19','20',
  '21','22','23','24','25','26','27','28','29','30',
  '31','32','33','34','35','36','37','38','39','40',
  '41','42','43','44','45','46','47',
];

async function main() {
  const args       = process.argv.slice(2);
  const skipCross  = args.includes('--skip-cross');
  const skipTax    = args.includes('--skip-tax') ? '--skip-tax' : '';
  const onlyArg    = args.find(a => a.startsWith('--only=') || args[args.indexOf('--only') + 1]);
  let targets      = ALL_PREFS;

  const onlyIdx = args.indexOf('--only');
  if (onlyIdx !== -1 && args[onlyIdx + 1]) {
    targets = args[onlyIdx + 1].split(',').map(c => c.trim().padStart(2, '0'));
  }

  const results = { ok: [], skip: [], fail: [] };

  console.log(`\n=== 全国データ生成開始: ${targets.length} 都道府県 ===\n`);

  for (const prefCode of targets) {
    // すでにデータがあればスキップ（--force で強制再生成）
    const muniPath = path.join(__dirname, '..', 'data', prefCode, 'municipalities.json');
    if (fs.existsSync(muniPath) && !args.includes('--force')) {
      console.log(`⏭️  ${prefCode}: すでに存在するためスキップ（--force で強制再生成）`);
      results.skip.push(prefCode);
      continue;
    }

    try {
      execSync(
        `node ${path.join(__dirname, 'generate-pref-data.js')} ${prefCode} ${skipTax}`,
        { stdio: 'inherit', cwd: path.join(__dirname, '..') }
      );
      results.ok.push(prefCode);
    } catch(e) {
      console.error(`❌ ${prefCode} 失敗: ${e.message}`);
      results.fail.push(prefCode);
    }
  }

  // 県境隣接の生成
  if (!skipCross) {
    console.log('\n=== 県境隣接ペア生成 ===\n');
    try {
      execSync(
        `node ${path.join(__dirname, 'generate-cross-adj.js')} --all`,
        { stdio: 'inherit', cwd: path.join(__dirname, '..') }
      );
    } catch(e) {
      console.error(`県境隣接生成失敗: ${e.message}`);
    }
  }

  console.log('\n=== 完了レポート ===');
  console.log(`✅ 成功: ${results.ok.length}件 [${results.ok.join(',')}]`);
  console.log(`⏭️  スキップ: ${results.skip.length}件 [${results.skip.join(',')}]`);
  if (results.fail.length > 0) {
    console.log(`❌ 失敗: ${results.fail.length}件 [${results.fail.join(',')}]`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
