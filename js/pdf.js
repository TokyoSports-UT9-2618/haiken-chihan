// ============================================================
// pdf.js — PDFレポート生成（jsPDF + html2canvas、CDN グローバルを使用）
// renderMapCanvas は PDF 専用の簡易地図レンダラー（Leaflet 非依存）
// ============================================================
import { CONFIG } from './config.js';
import {
  state, MUNICIPALITIES, BEFORE_COST,
  getHanPopulation, getHanMembers, calculateScore,
} from './state.js';
import { calcAfterCost, formatOku } from './cost.js';
import { geojsonCache } from './map.js';
import { showToast } from './ui.js';

function renderMapCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f0f0e8';
  ctx.fillRect(0, 0, w, h);

  if (!geojsonCache) return canvas;

  // Compute bounding box from municipality lat/lng (with padding)
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  MUNICIPALITIES.forEach(m => {
    if (m.lng && m.lat) {
      if (m.lng < minLng) minLng = m.lng;
      if (m.lng > maxLng) maxLng = m.lng;
      if (m.lat < minLat) minLat = m.lat;
      if (m.lat > maxLat) maxLat = m.lat;
    }
  });
  // Add padding (roughly 5% of extent)
  const lngPad = (maxLng - minLng) * 0.05 || 0.5;
  const latPad = (maxLat - minLat) * 0.05 || 0.5;
  minLng -= lngPad; maxLng += lngPad;
  minLat -= latPad; maxLat += latPad;

  function project(lat, lng) {
    const x = ((lng - minLng) / (maxLng - minLng)) * w;
    const y = (1 - (lat - minLat) / (maxLat - minLat)) * h;
    return [x, y];
  }

  geojsonCache.features.forEach(feature => {
    // コード優先で突合（同名市町村対策・map.jsと同方針）
    let code = String(feature.properties.code || feature.properties.N03_007 || '');
    if (code.length === 6) code = code.slice(0, 5);
    code = code.padStart(5, '0');
    let muni = MUNICIPALITIES.find(m => m.code === code);
    if (!muni) {
      const name = feature.properties.name || feature.properties.ward_ja || feature.properties.N03_004 || '';
      muni = MUNICIPALITIES.find(m => m.name === name);
    }
    const hanId = muni ? state.assignments[muni.code] : null;
    const han = hanId ? state.hans.find(h => h.id === hanId) : null;

    const geom = feature.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

    polys.forEach(poly => {
      const ring = poly[0];
      if (!ring || ring.length < 3) return;
      ctx.beginPath();
      ring.forEach(([lng, lat], i) => {
        const [x, y] = project(lat, lng);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      if (han) {
        const r = parseInt(han.color.slice(1, 3), 16);
        const g = parseInt(han.color.slice(3, 5), 16);
        const b = parseInt(han.color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r},${g},${b},0.75)`;
      } else {
        ctx.fillStyle = '#e0d8c8';
      }
      ctx.fill();
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 0.4;
      ctx.stroke();
    });
  });

  return canvas;
}

// ---- PDFタイポグラフィ統一ルール ----------------------------
// ・最小文字 16pt（このキャンバスは 794px=A4幅595pt なので 1px≒0.75pt → 22px≒16.5pt）
// ・行間 160%、斜体は使わない
// ・Windows/Mac 両用フォントスタック
const PDF_FONT = "'Yu Gothic','YuGothic','Hiragino Sans','Hiragino Kaku Gothic ProN','Meiryo',sans-serif";
const PAGE_W = 794;   // A4 @96dpi
const PAGE_H = 1123;
const FS = { base: 22, small: 22, head: 26, title: 32, score: 52 }; // px（最小22px≒16.5pt）

function pageShell(inner) {
  const div = document.createElement('div');
  div.style.cssText = `width:${PAGE_W}px;height:${PAGE_H}px;background:#fff;overflow:hidden;font-family:${PDF_FONT};line-height:1.6;color:#333;box-sizing:border-box;`;
  div.innerHTML = inner;
  return div;
}

// ページ配列を組み立てて返す。
// P1: 総評＋地図＋凡例（地図の下・大きめ文字） ／ P2以降: 藩一覧＋行政コスト比較
export function buildPDFReport(el) {
  const confirmedHans = state.hans.filter(h => h.confirmed);
  const score = calculateScore();
  const memberRate = state.sliders.memberReductionRate;
  const facilityRate = state.sliders.facilityClosureRate;
  const after = calcAfterCost(confirmedHans.map(h => getHanMembers(h.id)), memberRate, facilityRate);
  const saving = BEFORE_COST.total - after.total;
  const totalTax = MUNICIPALITIES.reduce((s, m) => s + m.taxRevenue, 0);
  const now = new Date().toLocaleDateString('ja-JP');

  const aiReviewEl = document.getElementById('aiReview');
  const aiReviewText = aiReviewEl && !aiReviewEl.querySelector('.ai-loading') ? aiReviewEl.textContent.trim() : null;

  const header = (sub) => `
    <div style="background:#2c3e50;color:#fff;padding:22px 36px 18px;">
      <div style="font-size:${FS.title}px;font-weight:bold;letter-spacing:0.05em;">廃県置藩シミュレーター</div>
      <div style="font-size:${FS.base}px;opacity:0.85;margin-top:2px;">${CONFIG.prefecture} 藩編成レポート ／ ${now}${sub ? ' ／ ' + sub : ''}</div>
    </div>`;

  // ---- P1: 総評＋地図＋凡例 ----
  const legendCols = confirmedHans.length > 12 ? 4 : 3;
  const legendHTML = confirmedHans.map(han => {
    const pop = getHanPopulation(han.id);
    return `<div style="display:flex;align-items:center;gap:10px;font-size:${FS.base}px;">
      <span style="flex-shrink:0;width:22px;height:22px;background:${han.color};border-radius:4px;display:inline-block;"></span>
      <span style="font-weight:bold;">${han.name}</span>
      <span style="color:#777;">${(pop / 10000).toFixed(0)}万人</span>
    </div>`;
  }).join('');

  const MAP_W = PAGE_W - 72, MAP_H = confirmedHans.length > 9 ? 420 : 470;
  const page1 = pageShell(`
    ${header('')}
    <div style="padding:24px 36px 0;">
      <div style="display:flex;align-items:baseline;gap:20px;">
        <div style="font-size:${FS.score}px;font-weight:bold;color:#e67e22;line-height:1.2;">${score.toLocaleString()}<span style="font-size:${FS.base}px;margin-left:4px;">点</span></div>
        <div style="font-size:${FS.base}px;color:#555;">${confirmedHans.length}藩編成 ／ ${CONFIG.prefecture}${MUNICIPALITIES.length}市町村</div>
      </div>
      ${aiReviewText ? `<div style="background:#f8f4e8;border-left:6px solid #e67e22;padding:14px 18px;border-radius:0 6px 6px 0;font-size:${FS.base}px;color:#444;margin-top:14px;">${aiReviewText}</div>` : ''}
      <canvas id="_pdfMapEl" width="${MAP_W}" height="${MAP_H}" style="display:block;width:${MAP_W}px;height:${MAP_H}px;border:1px solid #ccc;border-radius:6px;margin-top:18px;"></canvas>
      <div style="display:grid;grid-template-columns:repeat(${legendCols},1fr);gap:8px 18px;margin-top:16px;">${legendHTML}</div>
    </div>
  `);

  // ---- P2以降のブロック（実測でページに詰める） ----
  const blocks = [];
  blocks.push(`<div style="font-size:${FS.head}px;font-weight:bold;border-bottom:3px solid #2c3e50;padding-bottom:6px;">藩一覧（${confirmedHans.length}藩）</div>`);

  confirmedHans.forEach(han => {
    const members = getHanMembers(han.id);
    const pop = getHanPopulation(han.id);
    const tax = members.reduce((s, m) => s + m.taxRevenue, 0);
    const tokku = han.tokku ? `<span style="font-size:${FS.base}px;color:#1a6ea3;margin-left:10px;background:#e8f4fd;padding:2px 12px;border-radius:14px;">${han.tokku.label}</span>` : '';
    const aiHanEl = document.getElementById('ai-han-' + han.id);
    const aiHanText = aiHanEl && !aiHanEl.querySelector('.ai-loading-text') ? aiHanEl.textContent.trim() : null;
    blocks.push(`
      <div style="border:1px solid #ddd;border-left:8px solid ${han.color};border-radius:6px;padding:14px 18px;margin-top:14px;">
        <div style="font-size:${FS.head}px;font-weight:bold;">${han.name}${tokku}</div>
        <div style="font-size:${FS.base}px;color:#555;margin-top:2px;">${(pop / 10000).toFixed(1)}万人 ／ ${members.length}市町村 ／ 税収（参考）約${formatOku(tax)}億円</div>
        <div style="font-size:${FS.base}px;color:#888;margin-top:2px;">${members.map(m => m.name).join('・')}</div>
        ${aiHanText ? `<div style="font-size:${FS.base}px;color:#555;margin-top:8px;padding-top:8px;border-top:1px dashed #ddd;">${aiHanText}</div>` : ''}
      </div>`);
  });

  blocks.push(`
    <div style="font-size:${FS.head}px;font-weight:bold;border-bottom:3px solid #2c3e50;padding-bottom:6px;margin-top:28px;">行政コスト比較</div>
    <div style="display:flex;gap:16px;align-items:stretch;margin-top:14px;font-size:${FS.base}px;">
      <div style="flex:1;background:#fff5f5;padding:16px 18px;border-radius:6px;border:1px solid #fdd;">
        <div style="font-weight:bold;color:#c0392b;">廃県置藩 前</div>
        <div>首長・議員報酬: 約${formatOku(BEFORE_COST.totalSalary)}億円/年</div>
        <div>施設維持費: 約${formatOku(BEFORE_COST.totalFacility)}億円/年</div>
        <div style="font-weight:bold;margin-top:6px;">合計: 約${formatOku(BEFORE_COST.total)}億円/年</div>
      </div>
      <div style="display:flex;align-items:center;font-size:${FS.title}px;color:#888;">→</div>
      <div style="flex:1;background:#f0faf4;padding:16px 18px;border-radius:6px;border:1px solid #c3e6cb;">
        <div style="font-weight:bold;color:#27ae60;">廃県置藩 後（${confirmedHans.length}藩）</div>
        <div>首長・議員報酬: 約${formatOku(after.totalSalary)}億円/年</div>
        <div>施設維持費: 約${formatOku(after.totalFacility)}億円/年</div>
        <div style="font-weight:bold;margin-top:6px;">合計: 約${formatOku(after.total)}億円/年</div>
      </div>
    </div>
    <div style="margin-top:14px;font-size:${FS.head}px;font-weight:bold;color:${saving >= 0 ? '#27ae60' : '#e74c3c'};">
      ${saving >= 0 ? '▼ 削減コスト' : '▲ 増加コスト'}: 約${formatOku(Math.abs(saving))}億円/年
    </div>
    <div style="font-size:${FS.base}px;color:#888;">（議員削減率${Math.round(memberRate * 100)}%・施設統廃合率${Math.round(facilityRate * 100)}%前提）／ 税収規模（参考・2018年度）: 計約${formatOku(totalTax)}億円</div>
    <div style="margin-top:14px;font-size:${FS.base}px;color:#999;border-top:1px solid #eee;padding-top:10px;">※概算・推計値です（総務省地方公務員給与実態調査・e-Stat等より推計）。このデータで政策判断はしないでください。</div>
  `);

  // ---- 実測パジネーション: ブロックを P2以降に詰める ----
  el.innerHTML = '';
  el.appendChild(page1);

  const BODY_TOP = 135; // P2以降のヘッダー高さぶん
  const PAGE_PAD = 36;
  const usableH = PAGE_H - BODY_TOP - PAGE_PAD * 2;

  // 計測用コンテナ（el は position:fixed で画面外だがレイアウトはされる）
  const measurer = document.createElement('div');
  // overflow:hidden でマージン相殺を防ぎ、margin-top込みで計測する
  measurer.style.cssText = `width:${PAGE_W - PAGE_PAD * 2}px;font-family:${PDF_FONT};line-height:1.6;overflow:hidden;`;
  el.appendChild(measurer);

  let pageBlocks = [];
  const pages = [page1];
  const flushPage = () => {
    if (pageBlocks.length === 0) return;
    const p = pageShell(`${header(`${pages.length + 1}ページ`)}<div style="padding:${PAGE_PAD}px;padding-top:24px;">${pageBlocks.join('')}</div>`);
    pages.push(p);
    pageBlocks = [];
  };

  let acc = 0;
  blocks.forEach(html => {
    measurer.innerHTML = html;
    const h = measurer.firstElementChild ? measurer.getBoundingClientRect().height : 0;
    if (acc + h > usableH && pageBlocks.length > 0) { flushPage(); acc = 0; }
    pageBlocks.push(html);
    acc += h;
  });
  flushPage();
  measurer.remove();

  pages.slice(1).forEach(p => el.appendChild(p));

  const mapEl = page1.querySelector('#_pdfMapEl');
  mapEl.getContext('2d').drawImage(renderMapCanvas(MAP_W, MAP_H), 0, 0);

  return pages;
}

export async function generatePDF(btn) {
  if (!window.html2canvas || !window.jspdf) {
    alert('PDFライブラリの読み込みが完了していません。少し待ってから再試行してください。');
    return;
  }
  const aiEl = document.getElementById('aiReview');
  if (aiEl && aiEl.querySelector('.ai-loading')) {
    showToast('AI講評を取得中です。少し待ってから再度お試しください');
    return;
  }
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'PDF生成中...';
  try {
    const reportEl = document.getElementById('pdfReport');
    const pages = buildPDFReport(reportEl);

    const { jsPDF } = window.jspdf;
    const A4_W = 210, A4_H = 297;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // 1ページ = 1キャンバス。中身の途中でぶった切られない
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) doc.addPage();
      const canvas = await html2canvas(pages[i], {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: PAGE_W,
        height: PAGE_H,
        windowWidth: PAGE_W,
      });
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, A4_W, A4_H);
    }

    const score = calculateScore();
    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`haiken-chihan-${score}pt-${dateStr}.pdf`);
  } catch (e) {
    alert('PDF生成に失敗しました: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}
