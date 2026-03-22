#!/usr/bin/env node
/**
 * strip-holes.js
 * 既存の boundaries.geojson から内部リング（穴）を除去する。
 * e-Statシェープファイル由来の穴がLeafletで虫食い表示になるのを修正。
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

let totalFixed = 0;
let totalFiles = 0;

for (const pref of fs.readdirSync(dataDir).sort()) {
  const file = path.join(dataDir, pref, 'boundaries.geojson');
  if (!fs.existsSync(file)) continue;

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let holesRemoved = 0;

  for (const feature of data.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' && geom.coordinates.length > 1) {
      geom.coordinates = [geom.coordinates[0]];
      holesRemoved++;
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (poly.length > 1) {
          // 各サブポリゴンの外リングのみ残す（in-place）
          poly.splice(1);
          holesRemoved++;
        }
      }
    }
  }

  fs.writeFileSync(file, JSON.stringify(data));
  totalFiles++;
  totalFixed += holesRemoved;
  if (holesRemoved > 0) {
    console.log(`  ${pref}: ${holesRemoved} 個の穴を除去`);
  }
}

console.log(`\n完了: ${totalFiles} ファイル処理、合計 ${totalFixed} 個の穴を除去`);
