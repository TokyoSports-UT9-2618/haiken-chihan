// ============================================================
// ui.js — サイドパネル・モーダル・トースト・プログレスバーの描画
// 確定藩カード等のボタンは data-action 属性で描画し、
// クリックの委譲（delegation）は main.js が配線する
// ============================================================
import { CONFIG } from './config.js';
import {
  state, MUNICIPALITIES, BEFORE_COST, history,
  getHanPopulation, getHanMembers, calculateScore,
  getSlots, setSlots, getAutosave, buildSavePayload, MAX_SLOTS,
} from './state.js';
import { calcAfterCost, formatOku } from './cost.js';
import { updateAllStyles, formatPop } from './map.js';
import { loadAIComments } from './ai.js';

// ---- トースト -----------------------------------------------
let toastTimer = null;
export function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ---- サイドパネル -------------------------------------------
export function updateSidebar() {
  const currentHan = state.currentHanId ? state.hans.find(h => h.id === state.currentHanId) : null;

  // Current han section
  if (currentHan && !currentHan.confirmed) {
    document.getElementById('noHanMsg').style.display = 'none';
    document.getElementById('currentHanInfo').style.display = 'block';
    document.getElementById('currentHanName').textContent = currentHan.name + '（編集中）';

    const pop = getHanPopulation(state.currentHanId);
    const popMan = (pop / 10000).toFixed(1);
    document.getElementById('gaugePopText').textContent = popMan + '万人';

    // Gauge fill
    const maxDisplay = CONFIG.targetRange[1] * 1.2;
    const pct = Math.min((pop / maxDisplay) * 100, 100);
    const gaugeFill = document.getElementById('gaugeFill');
    gaugeFill.style.width = pct + '%';
    gaugeFill.className = 'gauge-fill ' + (pop < CONFIG.targetRange[0] ? 'under' : (pop > CONFIG.targetRange[1] ? 'over' : 'good'));
    document.getElementById('gaugeBarText').textContent = popMan + '万 / 目標40万';

    // Member list
    const members = getHanMembers(state.currentHanId);
    const listEl = document.getElementById('currentMuniList');
    if (members.length === 0) {
      listEl.innerHTML = '<div style="color:#999;font-size:12px;padding:4px;">市町村をクリックして追加</div>';
    } else {
      listEl.innerHTML = members
        .sort((a, b) => b.pop - a.pop)
        .map(m => `<div class="muni-item"><span>${m.name}</span><span class="muni-pop">${formatPop(m.pop)}</span></div>`)
        .join('');
    }

    // Cost preview
    const costPreview = document.getElementById('costPreview');
    if (members.length > 0) {
      costPreview.style.display = 'block';
      const salarySum = members.reduce((s, m) => s + m.cost.mayorAnnual + m.cost.memberAnnual, 0);
      const facilitySum = members.reduce((s, m) => s + m.cost.facilityAnnual, 0);
      const taxSum = members.reduce((s, m) => s + m.taxRevenue, 0);
      document.getElementById('costSalary').textContent = '約' + formatOku(salarySum) + '億円/年';
      document.getElementById('costFacility').textContent = '約' + formatOku(facilitySum) + '億円/年';
      document.getElementById('costTotal').textContent = '約' + formatOku(salarySum + facilitySum) + '億円/年';
      document.getElementById('costTax').textContent = '約' + formatOku(taxSum) + '億円/年';
    } else {
      costPreview.style.display = 'none';
    }

    document.getElementById('btnNew').disabled = true;
    document.getElementById('btnConfirm').disabled = members.length === 0;
  } else {
    document.getElementById('noHanMsg').style.display = 'block';
    document.getElementById('currentHanInfo').style.display = 'none';
    document.getElementById('btnNew').disabled = state.phase === 'completed';
    document.getElementById('btnConfirm').disabled = true;
  }

  // Confirmed list
  const confirmedHans = state.hans.filter(h => h.confirmed);
  const confirmedEl = document.getElementById('confirmedList');
  if (confirmedHans.length === 0) {
    confirmedEl.innerHTML = '<div style="color:#999; font-size:13px; font-style:italic;">まだありません</div>';
  } else {
    confirmedEl.innerHTML = confirmedHans.map(han => {
      const pop = getHanPopulation(han.id);
      const popMan = (pop / 10000).toFixed(1);
      let statusText, statusClass;
      if (pop >= CONFIG.targetRange[0] && pop <= CONFIG.targetRange[1]) {
        statusText = '適正'; statusClass = 'status-good';
      } else if (pop < CONFIG.targetRange[0]) {
        statusText = '少ない'; statusClass = pop < 250000 ? 'status-bad' : 'status-warn';
      } else {
        statusText = '多い'; statusClass = pop > 550000 ? 'status-bad' : 'status-warn';
      }
      const count = getHanMembers(han.id).length;
      const tokkuBadge = han.tokku ? `<div class="tokku-badge">${han.tokku.label}</div>` : '';
      return `<div class="han-card" style="border-left-color:${han.color}">
        <div class="han-card-name" style="color:${han.color}">${han.name}</div>
        <div class="han-card-pop">${popMan}万人（${count}市町村）</div>
        <div class="han-card-status ${statusClass}">${statusText}</div>
        ${tokkuBadge}
        <div class="han-card-actions">
          <button class="han-card-btn" data-action="rename" data-han="${han.id}">✏ リネーム</button>
          <button class="han-card-btn" style="color:#c0392b;" data-action="dissolve" data-han="${han.id}">やり直す</button>
        </div>
      </div>`;
    }).join('');
  }

  // Progress
  const assigned = Object.keys(state.assignments).length;
  document.getElementById('progressText').textContent = assigned + ' / ' + MUNICIPALITIES.length + ' 市町村を割り当て済み';
  document.getElementById('progressFill').style.width = (assigned / MUNICIPALITIES.length * 100) + '%';

  // Unassigned list (show when ≤10 remaining)
  const unassigned = MUNICIPALITIES.filter(m => !state.assignments[m.code]);
  const unassignedSection = document.getElementById('unassignedSection');
  if (unassigned.length > 0 && unassigned.length <= 10) {
    unassignedSection.style.display = 'block';
    document.getElementById('unassignedList').innerHTML = unassigned
      .sort((a, b) => b.pop - a.pop)
      .map(m => `<div class="unassigned-item" data-action="jump" data-code="${m.code}">
        <span class="u-name">${m.name}</span>
        <span class="u-pop">${formatPop(m.pop)}人</span>
        <span class="u-jump">→地図</span>
      </div>`).join('');
  } else {
    unassignedSection.style.display = 'none';
  }
}

// ---- ゲームクリアモーダル -----------------------------------
export function showGameClear() {
  const score = calculateScore();
  document.getElementById('finalScore').textContent = score.toLocaleString() + '点';

  const summaryEl = document.getElementById('hanSummary');
  const confirmedHans = state.hans.filter(h => h.confirmed);
  summaryEl.innerHTML = confirmedHans.map(han => {
    const pop = getHanPopulation(han.id);
    const popMan = (pop / 10000).toFixed(1);
    let statusText, statusClass;
    if (pop >= 300000 && pop <= 500000) {
      statusText = '適正'; statusClass = 'status-good';
    } else if (pop >= 250000 || pop <= 550000) {
      statusText = pop < 300000 ? '少ない' : '多い'; statusClass = 'status-warn';
    } else {
      statusText = pop < 250000 ? '少なすぎ' : '多すぎ'; statusClass = 'status-bad';
    }
    const members = getHanMembers(han.id);
    const tokkuText = han.tokku ? `<span style="font-size:11px;color:#1a6ea3;margin-left:6px;">${han.tokku.label}</span>` : '';
    const muniNames = members.map(m => m.name).join('・');
    const hanTax = members.reduce((s, m) => s + m.taxRevenue, 0);
    return `<div class="han-summary-item">
      <div class="han-color-dot" style="background:${han.color}"></div>
      <div style="flex:1">
        <strong>${han.name}</strong>
        <span style="color:#888;font-size:12px;margin-left:4px;">(${members.length}市町村)</span>
        ${tokkuText}
        <br><span style="font-size:13px;">${popMan}万人</span>
        <span class="${statusClass}" style="margin-left:8px;">${statusText}</span>
        <span style="font-size:12px;color:#555;margin-left:8px;">税収 約${formatOku(hanTax)}億円</span>
        <div style="font-size:11px;color:#aaa;margin-top:3px;line-height:1.5;">${muniNames}</div>
        <div class="ai-han-comment" id="ai-han-${han.id}"><span class="ai-loading-text">AIコメント生成中...</span></div>
      </div>
    </div>`;
  }).join('');

  // Cost comparison
  updateCostComparison();

  document.getElementById('modalOverlay').classList.add('show');

  // AI comments (async, non-blocking)
  loadAIComments(confirmedHans, score);
}

export function updateCostComparison() {
  const confirmedHans = state.hans.filter(h => h.confirmed);
  const memberRate = state.sliders.memberReductionRate;
  const facilityRate = state.sliders.facilityClosureRate;

  // Before
  document.getElementById('beforeSalary').textContent = '約' + formatOku(BEFORE_COST.totalSalary) + '億円/年';
  document.getElementById('beforeFacility').textContent = '約' + formatOku(BEFORE_COST.totalFacility) + '億円/年';
  document.getElementById('beforeTotal').textContent = '約' + formatOku(BEFORE_COST.total) + '億円/年';

  // After
  document.getElementById('afterTitle').textContent = '【廃県置藩 後】' + confirmedHans.length + '藩（あなたの設計）';
  const after = calcAfterCost(confirmedHans.map(h => getHanMembers(h.id)), memberRate, facilityRate);
  document.getElementById('afterSalary').textContent = '約' + formatOku(after.totalSalary) + '億円/年';
  document.getElementById('afterFacility').textContent = '約' + formatOku(after.totalFacility) + '億円/年';
  document.getElementById('afterTotal').textContent = '約' + formatOku(after.total) + '億円/年';

  // Saving
  const saving = BEFORE_COST.total - after.total;
  const savingEl = document.getElementById('costSaving');
  if (saving >= 0) {
    savingEl.textContent = '削減できるコスト: 約' + formatOku(saving) + '億円/年';
    savingEl.className = 'cost-saving';
  } else {
    savingEl.textContent = '増加コスト: 約' + formatOku(Math.abs(saving)) + '億円/年';
    savingEl.className = 'cost-saving negative';
  }

  // Tax summary per han
  const totalTax = MUNICIPALITIES.reduce((s, m) => s + m.taxRevenue, 0);
  const taxLines = confirmedHans.map(han => {
    const members = getHanMembers(han.id);
    const hanTax = members.reduce((s, m) => s + m.taxRevenue, 0);
    const pct = totalTax > 0 ? ((hanTax / totalTax) * 100).toFixed(1) : '0.0';
    return `<span style="display:inline-block;margin:2px 8px 2px 0;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${han.color};vertical-align:middle;margin-right:3px;"></span>${han.name}: 約${formatOku(hanTax)}億円（${pct}%）</span>`;
  }).join('');
  document.getElementById('taxSummary').innerHTML =
    `<div style="font-weight:bold;margin-bottom:4px;">税収規模（2018年度・参考値）: 計約${formatOku(totalTax)}億円</div>${taxLines}`;
}

export function onSliderChange() {
  const memberVal = parseInt(document.getElementById('sliderMember').value);
  const facilityVal = parseInt(document.getElementById('sliderFacility').value);
  state.sliders.memberReductionRate = memberVal / 100;
  state.sliders.facilityClosureRate = facilityVal / 100;
  document.getElementById('sliderMemberVal').textContent = memberVal + '%';
  document.getElementById('sliderFacilityVal').textContent = facilityVal + '%';
  updateCostComparison();
}

// ---- ヘルプモーダル -----------------------------------------
export function openHelp() {
  document.getElementById('helpOverlay').classList.add('show');
}

export function closeHelp(e) {
  if (e && e.target !== document.getElementById('helpOverlay')) return;
  document.getElementById('helpOverlay').classList.remove('show');
}

// ---- セーブ / ロードモーダル --------------------------------
function formatSavedAt(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP') + ' ' + d.toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'});
}

function slotSummary(s) {
  const confirmed = (s.gameState.hans || []).filter(h => h.confirmed).length;
  const prefLabel = s.prefCodes ? s.prefCodes.join(',') : (s.prefCode || '07');
  return `${prefLabel} / 確定${confirmed}藩 / ${formatSavedAt(s.savedAt)}`;
}

export function showSaveModal() {
  const slots = getSlots();
  const list  = document.getElementById('saveSlotList');
  list.innerHTML = '';
  for (let i = 0; i < MAX_SLOTS; i++) {
    const s = slots[i];
    const div = document.createElement('div');
    div.className = 'sl-slot' + (s ? '' : ' empty');
    if (s) {
      div.innerHTML = `<div class="sl-slot-info"><div class="sl-slot-name">${s.name || 'スロット'+(i+1)}</div><div class="sl-slot-meta">${slotSummary(s)}</div></div>`;
      const delBtn = document.createElement('button');
      delBtn.className = 'sl-slot-del';
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', (e) => deleteSlot(i, e));
      div.appendChild(delBtn);
      div.onclick = (e) => { if (!e.target.classList.contains('sl-slot-del')) saveToSlot(i); };
    } else {
      div.textContent = `スロット ${i+1}（空き）`;
      div.onclick = () => saveToSlot(i);
    }
    list.appendChild(div);
  }
  document.getElementById('saveOverlay').classList.add('show');
}

export function closeSaveModal() { document.getElementById('saveOverlay').classList.remove('show'); }

function saveToSlot(idx) {
  const name = document.getElementById('saveNameInput').value.trim() || `スロット${idx+1}`;
  const slots = getSlots();
  slots[idx] = buildSavePayload(name);
  setSlots(slots);
  closeSaveModal();
  showToast(`スロット${idx+1}に保存しました`);
}

function deleteSlot(idx, e) {
  e.stopPropagation();
  const slots = getSlots();
  slots[idx] = null;
  setSlots(slots);
  showSaveModal();
}

export function showLoadModal() {
  const slots  = getSlots();
  const auto   = getAutosave();
  const list   = document.getElementById('loadSlotList');
  list.innerHTML = '';
  // Autosave entry
  if (auto) {
    const div = document.createElement('div');
    div.className = 'sl-slot sl-autosave';
    div.innerHTML = `<div class="sl-slot-info"><div class="sl-slot-name">自動保存</div><div class="sl-slot-meta">${slotSummary(auto)}</div></div>`;
    div.onclick = () => applyLoadedState(auto);
    list.appendChild(div);
  }
  let hasAny = !!auto;
  slots.forEach((s, i) => {
    if (!s) return;
    hasAny = true;
    const div = document.createElement('div');
    div.className = 'sl-slot';
    div.innerHTML = `<div class="sl-slot-info"><div class="sl-slot-name">${s.name || 'スロット'+(i+1)}</div><div class="sl-slot-meta">${slotSummary(s)}</div></div>`;
    div.onclick = () => applyLoadedState(s);
    list.appendChild(div);
  });
  if (!hasAny) {
    list.innerHTML = '<div class="sl-slot empty">セーブデータがありません</div>';
  }
  document.getElementById('loadOverlay').classList.add('show');
}

export function closeLoadModal() { document.getElementById('loadOverlay').classList.remove('show'); }

function applyLoadedState(saveData) {
  closeLoadModal();
  const gs = saveData.gameState;
  state.hans         = gs.hans         || [];
  state.assignments  = gs.assignments  || {};
  state.hanCounter   = gs.hanCounter   || 0;
  state.currentHanId = gs.currentHanId || null;
  state.phase        = gs.phase        || 'playing';
  history.length = 0;
  document.getElementById('btnUndo').disabled = true;
  updateAllStyles();
  updateSidebar();
  showToast('セーブデータを読み込みました');
}
