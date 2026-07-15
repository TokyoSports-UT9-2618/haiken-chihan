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
    const name = feature.properties.name || feature.properties.ward_ja || feature.properties.N03_004 || '';
    const muni = MUNICIPALITIES.find(m => m.name === name);
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

function buildPDFReport(el) {
  const confirmedHans = state.hans.filter(h => h.confirmed);
  const score = calculateScore();
  const memberRate = state.sliders.memberReductionRate;
  const facilityRate = state.sliders.facilityClosureRate;
  const after = calcAfterCost(confirmedHans.map(h => getHanMembers(h.id)), memberRate, facilityRate);
  const saving = BEFORE_COST.total - after.total;
  const totalTax = MUNICIPALITIES.reduce((s, m) => s + m.taxRevenue, 0);
  const now = new Date().toLocaleDateString('ja-JP');

  // 凡例: 2列グリッド
  const legendHTML = confirmedHans.map(han =>
    `<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:3px 0;">
      <span style="flex-shrink:0;width:14px;height:14px;background:${han.color};border-radius:3px;display:inline-block;"></span>
      <span style="font-weight:bold;">${han.name}</span>
    </div>`
  ).join('');

  // AI overall review (from DOM)
  const aiReviewEl = document.getElementById('aiReview');
  const aiReviewText = aiReviewEl && !aiReviewEl.querySelector('.ai-loading') ? aiReviewEl.textContent.trim() : null;

  const hanRowsHTML = confirmedHans.map(han => {
    const members = getHanMembers(han.id);
    const pop = getHanPopulation(han.id);
    const tax = members.reduce((s, m) => s + m.taxRevenue, 0);
    const tokku = han.tokku ? `<span style="font-size:10px;color:#1a6ea3;margin-left:5px;background:#e8f4fd;padding:1px 5px;border-radius:3px;">${han.tokku.label}</span>` : '';
    // AI per-han comment (from DOM)
    const aiHanEl = document.getElementById('ai-han-' + han.id);
    const aiHanText = aiHanEl && !aiHanEl.querySelector('.ai-loading-text') ? aiHanEl.textContent.trim() : null;
    const aiRow = aiHanText
      ? `<tr><td colspan="5" style="padding:3px 8px 7px 28px;font-size:10px;color:#666;font-style:italic;border-bottom:1px solid #eee;background:#fafafa;">${aiHanText}</td></tr>`
      : '';
    return `<tr>
      <td style="padding:5px 8px;border-bottom:${aiHanText ? 'none' : '1px solid #eee'};white-space:nowrap;">
        <span style="display:inline-block;width:10px;height:10px;background:${han.color};border-radius:2px;margin-right:4px;vertical-align:middle;"></span>
        <strong>${han.name}</strong>${tokku}
      </td>
      <td style="padding:5px 8px;border-bottom:${aiHanText ? 'none' : '1px solid #eee'};text-align:right;white-space:nowrap;">${(pop / 10000).toFixed(1)}万人</td>
      <td style="padding:5px 8px;border-bottom:${aiHanText ? 'none' : '1px solid #eee'};text-align:right;white-space:nowrap;">${members.length}市町村</td>
      <td style="padding:5px 8px;border-bottom:${aiHanText ? 'none' : '1px solid #eee'};text-align:right;white-space:nowrap;">約${formatOku(tax)}億円</td>
      <td style="padding:5px 8px;border-bottom:${aiHanText ? 'none' : '1px solid #eee'};font-size:9px;color:#888;">${members.map(m => m.name).join('・')}</td>
    </tr>${aiRow}`;
  }).join('');

  const MAP_W = 714, MAP_H = 424;

  el.innerHTML = `
    <div style="background:#2c3e50;color:#fff;padding:18px 28px 14px;">
      <div style="font-size:20px;font-weight:bold;letter-spacing:0.05em;">廃県置藩シミュレーター</div>
      <div style="font-size:12px;opacity:0.8;margin-top:3px;">${CONFIG.prefecture} 藩編成レポート ／ ${now}</div>
    </div>
    <div style="padding:20px 28px;">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;">
        <div style="font-size:28px;font-weight:bold;color:#e67e22;">${score.toLocaleString()}<span style="font-size:14px;margin-left:2px;">点</span></div>
        <div style="font-size:12px;color:#555;">${confirmedHans.length}藩編成 ／ ${CONFIG.prefecture}${MUNICIPALITIES.length}市町村</div>
      </div>
      ${aiReviewText ? `<div style="background:#f8f4e8;border-left:4px solid #e67e22;padding:10px 14px;border-radius:0 4px 4px 0;font-size:12px;color:#444;line-height:1.7;margin-bottom:14px;">${aiReviewText}</div>` : ''}
      <div style="display:flex;gap:16px;align-items:flex-start;">
        <canvas id="_pdfMapEl" width="${MAP_W}" height="${MAP_H}" style="display:block;width:${MAP_W}px;height:${MAP_H}px;border:1px solid #ccc;border-radius:4px;flex-shrink:0;"></canvas>
        <div style="min-width:110px;">${legendHTML}</div>
      </div>
    </div>
    <div style="padding:0 28px 20px;">
      <div style="font-size:13px;font-weight:bold;background:#f5f5f5;padding:6px 10px;margin-bottom:0;border-radius:4px 4px 0 0;border:1px solid #ddd;">藩一覧（${confirmedHans.length}藩）</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #ddd;border-top:none;font-size:11px;">
        <thead>
          <tr style="background:#f9f9f9;color:#555;">
            <th style="padding:4px 8px;text-align:left;border-bottom:1px solid #ddd;">藩名</th>
            <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #ddd;">人口</th>
            <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #ddd;">市町村数</th>
            <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #ddd;">税収（参考）</th>
            <th style="padding:4px 8px;text-align:left;border-bottom:1px solid #ddd;">構成市町村</th>
          </tr>
        </thead>
        <tbody>${hanRowsHTML}</tbody>
      </table>
    </div>
    <div style="padding:0 28px 20px;">
      <div style="font-size:13px;font-weight:bold;background:#f5f5f5;padding:6px 10px;margin-bottom:0;border-radius:4px 4px 0 0;border:1px solid #ddd;">行政コスト比較</div>
      <div style="border:1px solid #ddd;border-top:none;padding:14px;display:flex;gap:14px;">
        <div style="flex:1;background:#fff5f5;padding:10px 12px;border-radius:4px;font-size:11px;border:1px solid #fdd;">
          <div style="font-weight:bold;font-size:12px;margin-bottom:6px;color:#c0392b;">廃県置藩 前</div>
          <div>首長・議員報酬: 約${formatOku(BEFORE_COST.totalSalary)}億円/年</div>
          <div>施設維持費: 約${formatOku(BEFORE_COST.totalFacility)}億円/年</div>
          <div style="font-weight:bold;margin-top:5px;font-size:12px;">合計: 約${formatOku(BEFORE_COST.total)}億円/年</div>
        </div>
        <div style="display:flex;align-items:center;font-size:18px;color:#888;">→</div>
        <div style="flex:1;background:#f0faf4;padding:10px 12px;border-radius:4px;font-size:11px;border:1px solid #c3e6cb;">
          <div style="font-weight:bold;font-size:12px;margin-bottom:6px;color:#27ae60;">廃県置藩 後（${confirmedHans.length}藩）</div>
          <div>首長・議員報酬: 約${formatOku(after.totalSalary)}億円/年</div>
          <div>施設維持費: 約${formatOku(after.totalFacility)}億円/年</div>
          <div style="font-weight:bold;margin-top:5px;font-size:12px;">合計: 約${formatOku(after.total)}億円/年</div>
        </div>
      </div>
      <div style="margin-top:10px;font-size:13px;font-weight:bold;color:${saving >= 0 ? '#27ae60' : '#e74c3c'};">
        ${saving >= 0 ? '▼ 削減コスト' : '▲ 増加コスト'}: 約${formatOku(Math.abs(saving))}億円/年
        <span style="font-size:11px;font-weight:normal;color:#888;">（議員削減率${Math.round(memberRate * 100)}% ／ 施設統廃合率${Math.round(facilityRate * 100)}%前提）</span>
      </div>
      <div style="margin-top:4px;font-size:11px;color:#888;">税収規模（参考・2018年度）: 計約${formatOku(totalTax)}億円</div>
    </div>
    <div style="padding:10px 28px 20px;font-size:9px;color:#bbb;border-top:1px solid #eee;">
      ※概算・推計値です（総務省地方公務員給与実態調査・e-Stat等より推計）。このデータで政策判断はしないでください。
    </div>
  `;

  const mapEl = el.querySelector('#_pdfMapEl');
  mapEl.getContext('2d').drawImage(renderMapCanvas(MAP_W, MAP_H), 0, 0);
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
    buildPDFReport(reportEl);

    const canvas = await html2canvas(reportEl, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: 794,
      windowWidth: 794,
    });

    const { jsPDF } = window.jspdf;
    const A4_W = 210, A4_H = 297;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imgW = A4_W;
    const pageH_px = Math.round((A4_H / A4_W) * canvas.width);
    const totalPages = Math.ceil(canvas.height / pageH_px);

    for (let i = 0; i < totalPages; i++) {
      if (i > 0) doc.addPage();
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      const sliceH = Math.min(pageH_px, canvas.height - i * pageH_px);
      pageCanvas.height = sliceH;
      pageCanvas.getContext('2d').drawImage(canvas, 0, -i * pageH_px);
      doc.addImage(pageCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, imgW, (sliceH / canvas.width) * imgW);
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
