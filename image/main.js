/* ============================================================
 * 전역 상태
 * ============================================================ */
let generatedImagesUrls = [];
let cachedBgImg = null;
let isBackedUp = true;
let undoHistory = [];
let redoHistory = [];
const MAX_UNDO = 100;
const SS_KEY = 'a4EventData';
const SS_BG_KEY = 'a4BgImage';

/* ============================================================
 * 의료법 위반 사전 (기존 앱과 동일)
 * ============================================================ */
const BANNED_WORDS = {
    '신데렐라주사': '티옥트산주사', '신데렐라': '티옥트산주사',
    '백옥주사': '글루타치온주사', '마늘주사': '알리마주사',
    '아기주사': '성장인자주사', '연어주사': 'PDRN주사',
    '감초주사': '히시파겐씨주사', '샤넬주사': '필로르가주사',
    '줄기세포': '피부재생관리', '엑소좀': '피부재생관리',
    '에토좀': '피부재생관리', 'ASCE': '피부재생관리',
    'TA': '염증주사',
    '1+1': '1회 가격에 2회 시술', '2+1': '2회 가격에 3회 시술',
    '5+5': '5회 가격에 10회 시술', '5+1': '5회 가격에 6회 시술',
    '6+6': '6회 가격에 12회 시술', '10+10': '10회 가격에 20회 시술',
    '프리미엄': '시그니처', '통증없는': '통증줄인', '내성없는': '내성줄인',
    '다이어트': '비만치료', 's/v': '혜택', '서비스': '혜택', '증정': '포함',
    '무제한': null, '연예인': null, '이영애': null, '선착순': null,
    '기간제한 없음': null, '실비': null, '즉각효과': null, '명품': null,
    '무너지지 않는': null, 'Free': null, '최초': null, '100%': null,
    '부작용 제로': null, '영구적': null, '완치': null, '최고': null,
    '유일': null, '특허': null, '국내 유일': null, '부작용 없음': null,
    '전무': null, '완전 제거': null, '즉시 해결': null, '세계 1위': null,
    '부작용 걱정 없는': null, '확실한 보장': null, '최적': null,
    '완벽': null, '첨단': null, '획기적': null, '비교불가': null
};
const EXCEPTION_WORDS = ['태반주사', '엑토좀PTT'];

// 검색마다 Regex를 새로 생성하지 않도록 모듈 로드 시 한 번만 컴파일
const EXCEPTION_REGEXES = EXCEPTION_WORDS.map(ex => ({
    word: ex,
    re: new RegExp(ex.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
}));
// BANNED_WORDS 소문자 중복 제거도 한 번만 처리
const BANNED_ENTRIES = (() => {
    const seen = new Set();
    return Object.entries(BANNED_WORDS).reduce((acc, [word, replacement]) => {
        const lower = word.toLowerCase();
        if (!seen.has(lower)) { seen.add(lower); acc.push({ word, lower, replacement }); }
        return acc;
    }, []);
})();

/* ============================================================
 * 유틸리티
 * ============================================================ */
function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, c => map[c]);
}
function generateUniqueId(prefix = 'id') {
    return prefix + '-' + Math.random().toString(36).substring(2, 11);
}
function sanitizeId(id) {
    if (!id || typeof id !== 'string') return null;
    return id.replace(/[^a-zA-Z0-9\-]/g, '') || null;
}
function hexToRgba(hex, alpha) {
    if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return `rgba(0,0,0,${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

/* ============================================================
 * 의료법 감지
 * ============================================================ */
function checkMedicalLaw(text) {
    if (!text) return [];
    const violations = [];
    const lowerText = text.toLowerCase();
    BANNED_ENTRIES.forEach(({ word, lower, replacement }) => {
        let searchFrom = 0, foundAt, hasNonException = false;
        while ((foundAt = lowerText.indexOf(lower, searchFrom)) !== -1) {
            let isException = false;
            for (const { word: exWord, re } of EXCEPTION_REGEXES) {
                for (const match of lowerText.matchAll(re)) {
                    if (foundAt >= match.index && foundAt < match.index + exWord.length) { isException = true; break; }
                }
                if (isException) break;
            }
            if (!isException) { hasNonException = true; break; }
            searchFrom = foundAt + 1;
        }
        if (hasNonException) violations.push({ word, replacement });
    });
    return violations;
}

function updateViolationUI(el) {
    const text = el.value;
    const violations = checkMedicalLaw(text);
    const currentWord = violations.length > 0 ? violations[0].word : '';
    if (violations.length === 0) {
        el.classList.remove('violation-input');
        el.removeAttribute('data-last-violation');
        el._violTooltip?.remove(); el._violTooltip = null;
        return;
    }
    if (el.getAttribute('data-last-violation') === currentWord && el._violTooltip) return;
    el._violTooltip?.remove(); el._violTooltip = null;
    el.classList.add('violation-input');
    el.setAttribute('data-last-violation', currentWord);
    const violation = violations[0];
    const tooltip = document.createElement('div');
    tooltip.className = 'violation-tooltip';
    tooltip.innerHTML = `<span>⚠️ 의료법 위반 소지: '${escapeHtml(violation.word)}'</span>`;
    if (violation.replacement) {
        const btn = document.createElement('button');
        btn.className = 'fix-btn';
        btn.innerHTML = `✨ '${escapeHtml(violation.replacement)}'로 수정`;
        btn.onmousedown = e => e.preventDefault();
        btn.onclick = e => {
            e.stopPropagation();
            const esc = violation.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            el.value = el.value.replace(new RegExp(esc, 'gi'), violation.replacement);
            el.removeAttribute('data-last-violation');
            updateViolationUI(el);
            saveSnapshot();
            debouncedGenerateImages();
        };
        tooltip.appendChild(btn);
    }
    const startHideTimer = () => {
        clearTimeout(el._tipTimer);
        el._tipTimer = setTimeout(() => { tooltip.remove(); el._violTooltip = null; el.removeAttribute('data-last-violation'); }, 200);
    };
    tooltip.addEventListener('mouseenter', () => clearTimeout(el._tipTimer));
    tooltip.addEventListener('mouseleave', startHideTimer);
    if (el._vlMouseLeave) el.removeEventListener('mouseleave', el._vlMouseLeave);
    el._vlMouseLeave = startHideTimer;
    el.addEventListener('mouseleave', el._vlMouseLeave);
    if (el._vlBlur) el.removeEventListener('blur', el._vlBlur);
    el._vlBlur = startHideTimer;
    el.addEventListener('blur', el._vlBlur);
    document.body.appendChild(tooltip);
    el._violTooltip = tooltip;
    const eRect = el.getBoundingClientRect();
    tooltip.style.top = (eRect.bottom + 4) + 'px';
    tooltip.style.left = eRect.left + 'px';
}

/* ============================================================
 * 스냅샷 / Undo / Redo
 * ============================================================ */
function getSnapshot() {
    const items = [];
    Array.from(document.getElementById('itemsContainer').children).forEach(child => {
        const undoId = child.getAttribute('data-undo-id') || generateUniqueId('id');
        if (child.classList.contains('item-row')) {
            items.push({
                type: 'item', id: undoId,
                itemName: child.querySelector('.item-name')?.value || '',
                isSublabel: child.querySelector('.item-sublabel')?.checked || false,
                prices: readPriceSlots(child),
                note: child.querySelector('.item-note-input')?.value || ''
            });
        } else if (child.classList.contains('section-title-wrapper')) {
            items.push({
                type: 'sectionTitle', id: undoId,
                value: child.querySelector('.section-title-input')?.value || '',
                collapsed: child.classList.contains('collapsed'),
                titleSize: parseInt(child.querySelector('.js-title-size-display')?.textContent) || 24,
                bodySize: parseInt(child.querySelector('.js-body-size-display')?.textContent) || 20,
                numSize: parseInt(child.querySelector('.js-num-size-display')?.textContent) || 35,
                isFullWidth: child.dataset.fullWidth === 'true'
            });
        } else if (child.classList.contains('column-break-wrapper')) {
            items.push({ type: 'columnBreak', id: undoId });
        }
    });
    return {
        topText: document.getElementById('topText')?.value || '',
        periodText: document.getElementById('periodText')?.value || '',
        periodNote: document.getElementById('periodNote')?.value || '',
        textColor: document.getElementById('textColorHex')?.value || '#000000',
        themeColor: document.getElementById('themeHex')?.value || '#000000',
        numColor: document.getElementById('numColorHex')?.value || '#000000',
        headerHeight: document.getElementById('headerHeight')?.value || '28',
        textScale: document.getElementById('textScale')?.value || '100',
        items
    };
}

function saveSnapshot() {
    const snap = getSnapshot();
    const str = JSON.stringify(snap);
    if (undoHistory.length > 0 && undoHistory[undoHistory.length - 1] === str) return;
    undoHistory.push(str);
    if (undoHistory.length > MAX_UNDO) undoHistory.shift();
    redoHistory = [];
    updateRemoteState();
    saveToSessionStorage(snap);
    markUnsaved();
}

let _typingTimer = null;
function handleInputSnapshot() {
    clearTimeout(_typingTimer);
    _typingTimer = setTimeout(() => saveSnapshot(), 400);
}

function updateRemoteState() {
    const u = document.getElementById('remoteUndo');
    const r = document.getElementById('remoteRedo');
    if (u) u.disabled = undoHistory.length === 0;
    if (r) r.disabled = redoHistory.length === 0;
}

function restoreSnapshot(data) {
    if (typeof data === 'string') data = JSON.parse(data);
    if (!data) return;
    if (data.topText !== undefined) document.getElementById('topText').value = data.topText;
    if (data.periodText !== undefined) document.getElementById('periodText').value = data.periodText;
    if (data.periodNote !== undefined) document.getElementById('periodNote').value = data.periodNote;
    if (data.textColor) updateTextColorSync(data.textColor);
    if (data.themeColor) updateColorSync(data.themeColor);
    if (data.numColor) updateNumColorSync(data.numColor);
    if (data.headerHeight !== undefined) {
        const sl = document.getElementById('headerHeight');
        sl.value = data.headerHeight;
        updateSliderBg(sl);
        document.getElementById('headerHeightLabel').value = data.headerHeight;
    }
    if (data.textScale !== undefined) {
        const sl = document.getElementById('textScale');
        if (sl) {
            sl.value = data.textScale;
            updateSliderBg(sl);
            document.getElementById('textScaleLabel').value = data.textScale;
        }
    }
    const container = document.getElementById('itemsContainer');
    // innerHTML 교체 전 남아있는 위반 툴팁을 body에서 제거
    container.querySelectorAll('.btn-input').forEach(el => { el._violTooltip?.remove(); el._violTooltip = null; });
    container.innerHTML = '';
    (data.items || []).forEach(item => {
        if (item.type === 'item') addItemRow(item);
        else if (item.type === 'sectionTitle') addSectionTitle(item.value, item.collapsed, item.id, item.titleSize || 24, item.bodySize || 20, item.numSize || 35, !!item.isFullWidth);
        else if (item.type === 'columnBreak') addColumnBreak(item.id);
    });
    document.querySelectorAll('.item-name, .section-title-input').forEach(el => updateViolationUI(el));
    refreshAccordionVisibility();
    updateRemoteState();
}

function undo() {
    if (undoHistory.length === 0) return;
    redoHistory.push(JSON.stringify(getSnapshot()));
    restoreSnapshot(undoHistory.pop());
    debouncedGenerateImages();
    updateRemoteState();
}
function redo() {
    if (redoHistory.length === 0) return;
    undoHistory.push(JSON.stringify(getSnapshot()));
    restoreSnapshot(redoHistory.pop());
    debouncedGenerateImages();
    updateRemoteState();
}

function markUnsaved() {
    if (!isBackedUp) return;
    isBackedUp = false;
    const btn = document.getElementById('remoteSaveBtn');
    if (btn) btn.classList.add('rbtn-unsaved');
}
function markSaved() {
    isBackedUp = true;
    const btn = document.getElementById('remoteSaveBtn');
    if (btn) btn.classList.remove('rbtn-unsaved');
}

/* ============================================================
 * 세션스토리지
 * ============================================================ */
function saveToSessionStorage(data = null) {
    try {
        sessionStorage.setItem(SS_KEY, JSON.stringify(data || getSnapshot()));
    } catch(e) {
        // QuotaExceededError 등 세션 저장 실패 — 항목 데이터조차 못 쓴 경우 경고
        showColorToast('세션 저장 실패: 브라우저 저장 공간이 부족합니다');
        return;
    }
    if (cachedBgImg?.src?.startsWith('data:')) {
        try { sessionStorage.setItem(SS_BG_KEY, cachedBgImg.src); }
        catch(e) { showColorToast('배경 이미지가 너무 커 세션에 저장되지 않았습니다'); }
    }
}
function restoreFromSessionStorage() {
    try {
        const saved = sessionStorage.getItem(SS_KEY);
        if (!saved) return false;
        restoreSnapshot(JSON.parse(saved));
        const bgData = sessionStorage.getItem(SS_BG_KEY);
        if (bgData) {
            const img = new Image();
            img.src = bgData;
            img.onload = () => { cachedBgImg = img; showBgThumb(bgData); generateImages(); };
        }
        return true;
    } catch(e) { return false; }
}

/* ============================================================
 * SVG 아이콘
 * ============================================================ */
const DRAG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const OPTS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;
const EXPAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

const BUILTIN_PRESETS = [];

/* ============================================================
 * DOM 빌더
 * ============================================================ */
function addSectionTitle(titleValue = '', isCollapsed = false, undoId = null, titleSize = 24, bodySize = 20, numSize = 35, isFullWidth = false) {
    const container = document.getElementById('itemsContainer');
    const wrapper = document.createElement('div');
    wrapper.className = 'section-title-wrapper' + (isCollapsed ? ' collapsed' : '');
    wrapper.setAttribute('data-undo-id', sanitizeId(undoId) || generateUniqueId('sec'));
    wrapper.dataset.fullWidth = isFullWidth ? 'true' : 'false';
    wrapper.innerHTML = `
        <div class="event-badge-wrapper">
            <span class="section-count-badge"></span>
            <div class="section-accordion-arrow"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></div>
        </div>
        <div class="section-main-row">
            <div class="drag-handle">${DRAG_SVG}</div>
            <div class="section-title-field">
                <div class="item-name-wrapper">
                    <textarea class="btn-input section-title-input auto-resize" placeholder="섹션 제목 (예: 보톡스 이벤트)">${escapeHtml(titleValue)}</textarea>
                    <div class="format-toolbar">
                        <button class="fmt-btn fmt-color" data-open="&lt;" data-close="&gt;" title="강조색 적용">강조</button>
                        <button class="fmt-btn fmt-up" data-open="&lt;+" data-close="+&gt;" title="글자 확대">확대</button>
                        <button class="fmt-btn fmt-dn" data-open="&lt;-" data-close="-&gt;" title="글자 축소">축소</button>
                        <button class="fmt-btn fmt-bold" data-open="{" data-close="}" title="굵게">굵게</button>
                    </div>
                </div>
            </div>
            <div style="display:flex;gap:4px;align-self:flex-end;margin-bottom:2px;">
                <button class="btn-copy btn-opts-settings js-toggle-sec-opts" title="옵션">${OPTS_SVG}</button>
                <button class="btn-copy js-dup-section" title="복제">${COPY_SVG}</button>
                <button class="btn-remove js-del-section" title="삭제">${CLOSE_SVG}</button>
            </div>
        </div>
        <div class="section-opts-row">
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
                <span style="font-size:11px;font-weight:700;color:var(--primary);">제목 크기</span>
                <div class="size-control-row">
                    <button class="size-btn js-title-size-minus">−</button>
                    <span class="size-value js-title-size-display">${titleSize}</span>
                    <button class="size-btn js-title-size-plus">+</button>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
                <span style="font-size:11px;font-weight:700;color:var(--primary);">본문 크기</span>
                <div class="size-control-row">
                    <button class="size-btn js-body-size-minus">−</button>
                    <span class="size-value js-body-size-display">${bodySize}</span>
                    <button class="size-btn js-body-size-plus">+</button>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
                <span style="font-size:11px;font-weight:700;color:var(--primary);">금액 크기</span>
                <div class="size-control-row">
                    <button class="size-btn js-num-size-minus">−</button>
                    <span class="size-value js-num-size-display">${numSize}</span>
                    <button class="size-btn js-num-size-plus">+</button>
                </div>
            </div>
            <div class="layout-toggle-row">
                <span style="font-size:11px;font-weight:700;color:var(--primary);">레이아웃</span>
                <div style="display:flex;gap:4px;">
                    <button class="layout-btn js-layout-split${!isFullWidth ? ' layout-btn-active' : ''}" title="2열 배치">2열</button>
                    <button class="layout-btn js-layout-full${isFullWidth ? ' layout-btn-active' : ''}" title="전체 너비">전체폭</button>
                </div>
            </div>
        </div>
    `;
    container.appendChild(wrapper);
    initDragAndDrop(wrapper);
    wrapper.querySelector('.event-badge-wrapper').addEventListener('click', () => toggleSection(wrapper));
    setTimeout(() => autoResizeTextarea(wrapper.querySelector('.section-title-input')), 0);
    refreshAccordionVisibility();
    debouncedGenerateImages();
}

function readPriceSlots(el) {
    const slots = el.querySelectorAll('.price-slots-wrap .price-slot');
    if (slots.length) return Array.from(slots).map((_, i) => ({
        label: el.querySelector(`.price-label-${i+1}`)?.value || '',
        val: el.querySelector(`.price-val-${i+1}`)?.value || ''
    }));
    // 구버전 p1/p2/p3 포맷 호환
    const prices = [];
    for (let i = 1; i <= 3; i++) {
        const l = el.querySelector(`.price-label-${i}`)?.value || '';
        const v = el.querySelector(`.price-val-${i}`)?.value || '';
        if (l || v) prices.push({ label: l, val: v });
    }
    return prices;
}

function buildPriceSlotEl(n, label = '', val = '') {
    const div = document.createElement('div');
    div.className = 'price-slot';
    div.innerHTML = `<input type="text" class="btn-input price-label-input price-label-${n}" placeholder="라벨" value="${escapeHtml(label)}"><input type="text" class="btn-input price-val-input price-val-${n}" placeholder="금액" value="${escapeHtml(val)}"><button class="btn-dup-price-slot js-dup-price-slot" title="슬롯 복제">${COPY_SVG}</button><button class="btn-remove-price-slot js-remove-price-slot" title="슬롯 삭제">−</button>`;
    return div;
}

function renumberPriceSlots(row) {
    row.querySelectorAll('.price-slots-wrap .price-slot').forEach((slot, i) => {
        const n = i + 1;
        const lbl = slot.querySelector('.price-label-input');
        const val = slot.querySelector('.price-val-input');
        lbl.className = `btn-input price-label-input price-label-${n}`;
        val.className = `btn-input price-val-input price-val-${n}`;
    });
}

function addItemRow(itemData = {}) {
    const { itemName='', isSublabel=false, note='', id=null } = itemData;
    // prices 배열 우선, 없으면 구버전 p1/p2/p3 호환
    let prices = itemData.prices;
    if (!prices) {
        prices = [];
        const { p1Label='', p1='', p2Label='', p2='', p3Label='', p3='' } = itemData;
        if (p1Label || p1) prices.push({ label: p1Label, val: p1 });
        if (p2Label || p2) prices.push({ label: p2Label, val: p2 });
        if (p3Label || p3) prices.push({ label: p3Label, val: p3 });
    }
    if (!prices.length) prices = [{ label: '', val: '' }];

    const container = document.getElementById('itemsContainer');
    const row = document.createElement('div');
    row.className = 'item-row item-expanded';
    row.setAttribute('data-undo-id', sanitizeId(id) || generateUniqueId('item'));
    row.innerHTML = `
        <div class="item-row-top">
            <div class="drag-handle">${DRAG_SVG}</div>
            <div class="item-name-wrapper">
                <textarea class="btn-input item-name auto-resize" placeholder="항목명 (예: 아쿠아필(블랙헤드))">${escapeHtml(itemName)}</textarea>
                <div class="format-toolbar">
                    <button class="fmt-btn fmt-color" data-open="&lt;" data-close="&gt;" title="강조색 적용">강조</button>
                    <button class="fmt-btn fmt-up" data-open="&lt;+" data-close="+&gt;" title="글자 확대">확대</button>
                    <button class="fmt-btn fmt-dn" data-open="&lt;-" data-close="-&gt;" title="글자 축소">축소</button>
                    <button class="fmt-btn fmt-bold" data-open="{" data-close="}" title="굵게">굵게</button>
                </div>
            </div>
            <input type="checkbox" class="item-sublabel" style="display:none" ${isSublabel ? 'checked' : ''}>
            <button class="btn-action-text js-toggle-sublabel${isSublabel ? ' btn-action-active' : ''}" title="소제목 행으로 표시 (가격 없이 강조 행)">소제목</button>
            <button class="btn-action-text js-toggle-note${note ? ' btn-action-active' : ''}" title="비고 텍스트 추가">비고</button>
            <button class="btn-copy js-dup-item" title="복제">${COPY_SVG}</button>
            <button class="btn-remove js-del-item" title="삭제">${CLOSE_SVG}</button>
        </div>
        <div class="item-prices-row${isSublabel ? ' hidden' : ''}">
            <div class="price-slots-wrap"></div>
            <button class="btn-add-price-slot js-add-price-slot" title="가격 슬롯 추가">+</button>
        </div>
        <div class="item-note-row${note ? '' : ' hidden'}">
            <input type="text" class="btn-input item-note-input" placeholder="※ 비고 (작은글씨)" value="${escapeHtml(note)}">
        </div>
    `;
    const slotsWrap = row.querySelector('.price-slots-wrap');
    prices.forEach((p, i) => slotsWrap.appendChild(buildPriceSlotEl(i + 1, p.label, p.val)));
    renumberPriceSlots(row);

    container.appendChild(row);
    row.querySelector('.js-toggle-sublabel').addEventListener('click', function() {
        const checkbox = row.querySelector('.item-sublabel');
        checkbox.checked = !checkbox.checked;
        this.classList.toggle('btn-action-active', checkbox.checked);
        row.querySelector('.item-prices-row').classList.toggle('hidden', checkbox.checked);
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    initDragAndDrop(row);
    setTimeout(() => { const ta = row.querySelector('.item-name'); if (ta) autoResizeTextarea(ta); }, 0);
    refreshAccordionVisibility();
    debouncedGenerateImages();
}

function addColumnBreak(undoId = null) {
    const container = document.getElementById('itemsContainer');
    const wrapper = document.createElement('div');
    wrapper.className = 'column-break-wrapper';
    wrapper.setAttribute('data-undo-id', sanitizeId(undoId) || generateUniqueId('col'));
    wrapper.innerHTML = `
        <div class="drag-handle">${DRAG_SVG}</div>
        <div class="column-break-line">↔ 여기서 오른쪽 컬럼으로 분리 ↔</div>
        <button class="btn-remove js-del-colbreak" title="삭제">${CLOSE_SVG}</button>
    `;
    container.appendChild(wrapper);
    initDragAndDrop(wrapper);
    refreshAccordionVisibility();
    debouncedGenerateImages();
}


function autoResizeTextarea(el) {
    el.style.height = '1px';
    el.style.height = Math.max(32, el.scrollHeight) + 'px';
}

function toggleSection(wrapper) {
    wrapper.classList.toggle('collapsed');
    refreshAccordionVisibility();
    refreshBookmarks();
}

function refreshAccordionVisibility() {
    const container = document.getElementById('itemsContainer');
    let inCollapsed = false;
    Array.from(container.children).forEach(node => {
        if (node.classList.contains('section-title-wrapper')) {
            inCollapsed = node.classList.contains('collapsed');
            let count = 0;
            let next = node.nextElementSibling;
            while (next && !next.classList.contains('section-title-wrapper') &&
                   !next.classList.contains('column-break-wrapper')) {
                if (next.classList.contains('item-row')) count++;
                next = next.nextElementSibling;
            }
            const arrow = node.querySelector('.section-accordion-arrow');
            if (arrow) arrow.style.display = count > 0 ? 'flex' : 'none';
            const badge = node.querySelector('.section-count-badge');
            if (badge) { badge.textContent = count > 0 ? count + '개' : ''; badge.style.display = (inCollapsed && count > 0) ? 'inline-flex' : 'none'; }
        } else if (node.classList.contains('column-break-wrapper')) {
            inCollapsed = false;
            node.classList.remove('item-hidden');
        } else if (node.classList.contains('item-row')) {
            node.classList.toggle('item-hidden', inCollapsed);
            if (!inCollapsed) {
                const ta = node.querySelector('.item-name');
                if (ta) autoResizeTextarea(ta);
            }
        }
    });
    updateItemsEmptyState();
    updateColSplitHint();
    refreshSectionGrouping();
}

function updateItemsEmptyState() {
    const container = document.getElementById('itemsContainer');
    const hasItems = Array.from(container.children).some(n =>
        n.classList.contains('item-row') || n.classList.contains('section-title-wrapper') ||
        n.classList.contains('column-break-wrapper')
    );
    let hint = document.getElementById('itemsEmptyHint');
    if (!hasItems) {
        if (!hint) {
            hint = document.createElement('div'); hint.id = 'itemsEmptyHint';
            hint.className = 'items-empty-hint';
            hint.innerHTML = `<span style="font-size:32px">📋</span><span style="font-weight:700;font-size:14px;color:#8B95A1;">항목이 없습니다</span><span style="font-size:12px;color:#ABB3BB;line-height:1.6;">아래 버튼으로 섹션과 항목을 추가하세요</span>`;
            container.appendChild(hint);
        }
    } else {
        if (hint) hint.remove();
    }
}

/* ============================================================
 * 북마크 패널
 * ============================================================ */
let _bookmarkTimer = null;
function refreshBookmarks() {
    const list = document.getElementById('bookmarkList');
    if (!list) return;
    const children = Array.from(document.getElementById('itemsContainer').children)
        .filter(n => !n.classList.contains('items-empty-hint'));

    list.innerHTML = '';

    if (children.length === 0) {
        list.classList.remove('bm-two-col');
        list.innerHTML = '<div class="bookmark-empty">항목을 추가하면<br>목차가 표시됩니다</div>';
        return;
    }

    const hasColBreak = children.some(n => n.classList.contains('column-break-wrapper'));

    function makeEntry(node) {
        const title = node.querySelector('.section-title-input')?.value.trim() || '(제목 없음)';
        const entry = document.createElement('div');
        const isActive = !node.classList.contains('collapsed');
        entry.className = 'bm-entry bm-section' + (isActive ? ' bm-active' : '');
        entry.textContent = title;
        entry.addEventListener('click', () => {
            document.querySelectorAll('#itemsContainer .section-title-wrapper').forEach(s => {
                s.classList.toggle('collapsed', s !== node);
            });
            refreshAccordionVisibility();
            refreshBookmarks();
            scrollToItem(node);
        });
        return entry;
    }

    if (hasColBreak) {
        list.classList.add('bm-two-col');
        const leftCol = document.createElement('div');
        leftCol.className = 'bm-col';
        const rightCol = document.createElement('div');
        rightCol.className = 'bm-col';
        let currentCol = leftCol;
        children.forEach(node => {
            if (node.classList.contains('column-break-wrapper')) {
                currentCol = rightCol;
            } else if (node.classList.contains('section-title-wrapper')) {
                currentCol.appendChild(makeEntry(node));
            }
        });
        list.appendChild(leftCol);
        list.appendChild(rightCol);
    } else {
        list.classList.remove('bm-two-col');
        children.forEach(node => {
            if (node.classList.contains('section-title-wrapper')) {
                list.appendChild(makeEntry(node));
            }
        });
    }
}

function scrollToItem(el) {
    const itemsTabBtn = document.querySelector('.tab-btn[data-tab="items"]');
    if (itemsTabBtn && !itemsTabBtn.classList.contains('active')) {
        itemsTabBtn.click();
    }
    setTimeout(() => {
        const scrollContainer = document.querySelector('.items-scroll');
        if (scrollContainer) {
            const containerTop = scrollContainer.getBoundingClientRect().top;
            const elTop = el.getBoundingClientRect().top;
            const targetScroll = scrollContainer.scrollTop + (elTop - containerTop) - 8;
            scrollContainer.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
        } else {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        el.classList.add('bm-highlight');
        setTimeout(() => el.classList.remove('bm-highlight'), 800);
    }, itemsTabBtn && !itemsTabBtn.classList.contains('active') ? 80 : 0);
}

function initBookmarkObserver() {
    const container = document.getElementById('itemsContainer');
    new MutationObserver(() => {
        clearTimeout(_bookmarkTimer);
        _bookmarkTimer = setTimeout(refreshBookmarks, 150);
    }).observe(container, { childList: true });

    container.addEventListener('input', () => {
        clearTimeout(_bookmarkTimer);
        _bookmarkTimer = setTimeout(refreshBookmarks, 300);
    });
}

function refreshSectionGrouping() {
    const container = document.getElementById('itemsContainer');
    const children = Array.from(container.children);

    // 기존 그룹 클래스 초기화
    children.forEach(el => el.classList.remove('section-group-item', 'section-group-last', 'section-group-empty'));

    let n = 0;
    for (let i = 0; i < children.length; i++) {
        const el = children[i];
        if (!el.classList.contains('section-title-wrapper')) continue;
        n++;

        // 번호 뱃지 삽입 또는 업데이트
        const bw = el.querySelector('.event-badge-wrapper');
        if (bw) {
            let dot = bw.querySelector('.section-num-dot');
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'section-num-dot';
                bw.insertBefore(dot, bw.firstChild);
            }
            dot.textContent = '이벤트' + n;
        }

        // 그룹 내 보이는 항목 수집
        const items = [];
        for (let j = i + 1; j < children.length; j++) {
            const nx = children[j];
            if (nx.classList.contains('section-title-wrapper') || nx.classList.contains('column-break-wrapper')) break;
            if (nx.classList.contains('item-row') && !nx.classList.contains('item-hidden')) items.push(nx);
        }

        if (items.length > 0) {
            items.forEach(it => it.classList.add('section-group-item'));
            items[items.length - 1].classList.add('section-group-last');
        } else {
            el.classList.add('section-group-empty');
        }
    }
}

function updateColSplitHint() {
    const container = document.getElementById('itemsContainer');
    const hint = document.getElementById('colSplitHint');
    if (!hint) return;
    const hasColBreak = Array.from(container.children).some(n => n.classList.contains('column-break-wrapper'));
    hint.textContent = hasColBreak ? '' : '컬럼 구분 없으면 1열 전체 너비';
}

/* ============================================================
 * 드래그 앤 드롭
 * ============================================================ */
let dragSrc = null;
function initDragAndDrop(el) {
    el.addEventListener('mousedown', onDragMouseDown);
    el.addEventListener('touchstart', onDragTouchStart, { passive: false });
}
function onDragMouseDown(e) {
    if (!e.target.closest('.drag-handle')) return;
    e.preventDefault();
    dragSrc = this;
    dragSrc.classList.add('dragging');
    document.addEventListener('mousemove', onDragMouseMove);
    document.addEventListener('mouseup', onDragMouseUp);
}
function onDragMouseMove(e) {
    if (!dragSrc) return;
    const container = document.getElementById('itemsContainer');
    const els = Array.from(container.children).filter(c => c !== dragSrc && !c.classList.contains('items-empty-hint'));
    const mouseY = e.clientY;
    let insertBefore = null;
    for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (mouseY < rect.top + rect.height / 2) { insertBefore = el; break; }
    }
    insertBefore ? container.insertBefore(dragSrc, insertBefore) : container.appendChild(dragSrc);
}
function onDragMouseUp() {
    if (!dragSrc) return;
    dragSrc.classList.remove('dragging');
    dragSrc = null;
    document.removeEventListener('mousemove', onDragMouseMove);
    document.removeEventListener('mouseup', onDragMouseUp);
    refreshAccordionVisibility();
    saveSnapshot();
    debouncedGenerateImages();
}
function onDragTouchStart(e) {
    if (!e.target.closest('.drag-handle')) return;
    e.preventDefault();
    dragSrc = this;
    dragSrc.classList.add('dragging');
    document.addEventListener('touchmove', onDragTouchMove, { passive: false });
    document.addEventListener('touchend', onDragTouchEnd);
}
function onDragTouchMove(e) {
    e.preventDefault();
    if (!dragSrc) return;
    const touch = e.touches[0];
    const container = document.getElementById('itemsContainer');
    const els = Array.from(container.children).filter(c => c !== dragSrc && !c.classList.contains('items-empty-hint'));
    let insertBefore = null;
    for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (touch.clientY < rect.top + rect.height / 2) { insertBefore = el; break; }
    }
    insertBefore ? container.insertBefore(dragSrc, insertBefore) : container.appendChild(dragSrc);
}
function onDragTouchEnd() {
    if (!dragSrc) return;
    dragSrc.classList.remove('dragging');
    dragSrc = null;
    document.removeEventListener('touchmove', onDragTouchMove);
    document.removeEventListener('touchend', onDragTouchEnd);
    refreshAccordionVisibility();
    saveSnapshot();
    debouncedGenerateImages();
}

/* ============================================================
 * 텍스트 서식 DSL (기존 앱과 동일: tokenize → parse → flattenAST)
 * ============================================================ */
const SIZE_STEP = 8;

function tokenize(text) {
    const tokens = []; let cur = ''; let i = 0;
    const push = () => { if (cur) { tokens.push({ type: 'TEXT', value: cur }); cur = ''; } };
    while (i < text.length) {
        if (text[i] === '<') {
            push();
            let plus = 0, minus = 0, j = i + 1;
            while (j < text.length && text[j] === '+') { plus++; j++; }
            if (plus === 0) while (j < text.length && text[j] === '-') { minus++; j++; }
            tokens.push({ type: 'OPEN_ANGLE', sizeDelta: plus > 0 ? plus : -minus });
            i = j;
        } else if (text[i] === '>' && (i === 0 || text[i-1] !== '=')) {
            let plus = 0, minus = 0, k = cur.length - 1;
            while (k >= 0 && cur[k] === '+') { plus++; k--; }
            if (plus === 0) while (k >= 0 && cur[k] === '-') { minus++; k--; }
            if (plus > 0 || minus > 0) cur = cur.substring(0, k + 1);
            push();
            tokens.push({ type: 'CLOSE_ANGLE', sizeDelta: plus > 0 ? plus : -minus });
            i++;
        } else if (text[i] === '{') {
            push(); tokens.push({ type: 'OPEN_BRACE' }); i++;
        } else if (text[i] === '}') {
            push(); tokens.push({ type: 'CLOSE_BRACE' }); i++;
        } else { cur += text[i]; i++; }
    }
    push(); return tokens;
}

function parse(tokens) {
    let pos = 0;
    function parseBlock() {
        const nodes = [];
        while (pos < tokens.length) {
            const t = tokens[pos];
            if (t.type === 'TEXT') { nodes.push({ type: 'TEXT', value: t.value }); pos++; }
            else if (t.type === 'OPEN_ANGLE') {
                pos++; const children = parseBlock();
                let cd = 0;
                if (pos < tokens.length && tokens[pos].type === 'CLOSE_ANGLE') { cd = tokens[pos].sizeDelta; pos++; }
                nodes.push({ type: 'ANGLE', sizeDelta: t.sizeDelta || cd, children });
            } else if (t.type === 'OPEN_BRACE') {
                pos++; const children = parseBlock();
                if (pos < tokens.length && tokens[pos].type === 'CLOSE_BRACE') pos++;
                nodes.push({ type: 'BRACE', children });
            } else break;
        }
        return nodes;
    }
    return parseBlock();
}

function flattenAST(nodes, state) {
    let chunks = [];
    for (const node of nodes) {
        if (node.type === 'TEXT') {
            if (node.value) chunks.push({ text: node.value, isHighlight: state.isHighlight, sizeDelta: state.sizeDelta, boldLevel: state.boldLevel });
        } else if (node.type === 'ANGLE') {
            chunks = chunks.concat(flattenAST(node.children, { ...state, isHighlight: state.isHighlight || node.sizeDelta === 0, sizeDelta: state.sizeDelta + node.sizeDelta }));
        } else if (node.type === 'BRACE') {
            chunks = chunks.concat(flattenAST(node.children, { ...state, boldLevel: state.boldLevel + 1 }));
        }
    }
    return chunks;
}

function parseStyledText(text) {
    text = String(text || '');
    const raw = flattenAST(parse(tokenize(text)), { isHighlight: false, sizeDelta: 0, boldLevel: 0 });
    const merged = [];
    let cur = null;
    for (const chunk of raw) {
        if (!cur) { cur = { ...chunk }; }
        else if (cur.isHighlight === chunk.isHighlight && cur.sizeDelta === chunk.sizeDelta && cur.boldLevel === chunk.boldLevel) { cur.text += chunk.text; }
        else { merged.push(cur); cur = { ...chunk }; }
    }
    if (cur) merged.push(cur);
    return merged;
}

function getChunkFont(chunk, baseSize, isBold, fonts) {
    const size = Math.max(8, baseSize + chunk.sizeDelta * SIZE_STEP);
    const weight = chunk.boldLevel >= 2 ? 900 : chunk.boldLevel === 1 ? 800 : isBold ? 700 : 600;
    const family = isBold || chunk.boldLevel > 0 ? fonts.bold : fonts.main;
    return { font: `${weight} ${size}px ${family}`, size };
}

function wrapStyledText(ctx, text, maxWidth, baseSize, isBold, fonts) {
    text = String(text || '');
    if (!text) return [{ chunks: [], totalWidth: 0 }];
    const lines = [];
    const chunks = parseStyledText(text);
    let lineChunks = [], lineW = 0;

    for (const chunk of chunks) {
        const { font, size } = getChunkFont(chunk, baseSize, isBold, fonts);
        ctx.font = font;
        let sub = '';
        for (let i = 0; i < chunk.text.length; i++) {
            const ch = chunk.text[i];
            if (ch === '\n') {
                if (sub) { const w = ctx.measureText(sub).width; lineChunks.push({ ...chunk, text: sub, width: w, font }); lineW += w; }
                lines.push({ chunks: lineChunks, totalWidth: lineW }); lineChunks = []; lineW = 0; sub = ''; continue;
            }
            const test = sub + ch;
            if (lineW + ctx.measureText(test).width > maxWidth && (lineW > 0 || sub.length > 0)) {
                if (sub) { const w = ctx.measureText(sub).width; lineChunks.push({ ...chunk, text: sub, width: w, font }); lineW += w; }
                lines.push({ chunks: lineChunks, totalWidth: lineW }); lineChunks = []; lineW = 0; sub = ch;
            } else { sub = test; }
        }
        if (sub) { const w = ctx.measureText(sub).width; lineChunks.push({ ...chunk, text: sub, width: w, font }); lineW += w; }
    }
    if (lineChunks.length > 0) lines.push({ chunks: lineChunks, totalWidth: lineW });
    return lines.length ? lines : [{ chunks: [], totalWidth: 0 }];
}

/* ============================================================
 * 캔버스 유틸리티
 * ============================================================ */
const CONFIG = {
    W: 1240, H: 1754, SCALE: 2,
    fonts: {
        main: "'Paperlogy','Pretendard','Noto Sans JP','Noto Sans SC','Noto Sans Thai',sans-serif",
        bold: "'GmarketSansBold','Noto Sans JP','Noto Sans SC','Noto Sans Thai',sans-serif",
        medium: "'GmarketSansMedium','Noto Sans JP','Noto Sans SC','Noto Sans Thai',sans-serif",
        cheoeumcheoreom: "'210 Cheoeumcheoreom','GmarketSansBold',sans-serif"
    }
};

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath(); ctx.fill();
}

/* ============================================================
 * 섹션 높이 측정 (배경 위 카드 배경 그리기용 사전 계산)
 * ============================================================ */
function measureItemRow(ctx, item, colW, fonts, bodySize = 20) {
    if (item.isSublabel) return 44;
    const NAME_SIZE = bodySize, PAD_Y = 12, LINE_H = NAME_SIZE * 1.45, NOTE_SIZE = 17;
    const nameLines = wrapStyledText(ctx, item.itemName, Math.floor(colW * 0.50), NAME_SIZE, false, fonts);
    const noteH = item.note ? (NOTE_SIZE * 1.5 + 2) : 0;
    return Math.max(Math.ceil(nameLines.length * LINE_H) + PAD_Y * 2 + noteH, 52);
}
function measureSection(ctx, sec, colW, fonts) {
    let h = sec.title ? (sec.titleSize || 24) + 16 : 0;
    for (const item of sec.items) h += measureItemRow(ctx, item, colW, fonts, sec.bodySize || 20);
    if (sec.items.length > 0) h += 1;
    return h;
}
function collectSectionRects(ctx, sections, colX, startY, maxY, colW, fonts) {
    const rects = []; let y = startY;
    for (const sec of sections) {
        if (y >= maxY) break;
        const secH = measureSection(ctx, sec, colW, fonts);
        rects.push({ x: colX, y, w: colW, h: Math.min(secH, maxY - y) });
        y += secH + 15;
    }
    return rects;
}

/* ============================================================
 * 캔버스 렌더링 — A4 두 컬럼 레이아웃
 * ============================================================ */
function drawA4Canvas(bgImg, rows, headerRatio, themeColor, numColor = '#000000', topText = '', periodText = '', textColor = '#000000', periodNote = '') {
    const { W, H, SCALE, fonts } = CONFIG;
    const canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 흰색 배경
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const headerH = Math.round(H * headerRatio);
    const MARGIN = 41;

    // 배경 이미지 — 전체 캔버스 cover
    if (bgImg) {
        const iAR = bgImg.width / bgImg.height;
        const zAR = W / H;
        let sx, sy, sw, sh;
        if (iAR > zAR) { sh = bgImg.height; sw = sh * zAR; sx = (bgImg.width - sw) / 2; sy = 0; }
        else { sw = bgImg.width; sh = sw / zAR; sx = 0; sy = (bgImg.height - sh) / 2; }
        ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, W, H);
    }

    // 컨텐츠 영역
    const contentTop = headerH + (headerH > 0 ? 15 : MARGIN);
    const contentBottom = H - MARGIN;
    const COL_GAP = 15;
    const twoColW = Math.floor((W - MARGIN * 2 - COL_GAP) / 2);
    const fullW = W - MARGIN * 2;
    const col1X = MARGIN;
    const col2X = MARGIN + twoColW + COL_GAP;

    // 섹션 카드 흰색 배경 + 박스 그림자 (rows 기반)
    const sectionRects = [];
    let _y = contentTop;
    for (const row of rows) {
        if (_y >= contentBottom) break;
        if (row.type === 'full') {
            const h = measureSection(ctx, row.section, fullW, fonts);
            sectionRects.push({ x: col1X, y: _y, w: fullW, h: Math.min(h, contentBottom - _y) });
            _y += h + 15;
        } else {
            let leftY = _y, rightY = _y;
            for (const sec of row.left) {
                if (leftY >= contentBottom) break;
                const h = measureSection(ctx, sec, twoColW, fonts);
                sectionRects.push({ x: col1X, y: leftY, w: twoColW, h: Math.min(h, contentBottom - leftY) });
                leftY += h + 15;
            }
            for (const sec of row.right) {
                if (rightY >= contentBottom) break;
                const h = measureSection(ctx, sec, twoColW, fonts);
                sectionRects.push({ x: col2X, y: rightY, w: twoColW, h: Math.min(h, contentBottom - rightY) });
                rightY += h + 15;
            }
            _y = Math.max(leftY, rightY);
        }
    }
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.09)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    sectionRects.forEach(({ x, y, w, h }) => ctx.fillRect(x, y, w, h));
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // rows 기반 렌더링
    let y = contentTop;
    for (const row of rows) {
        if (y >= contentBottom) break;
        if (row.type === 'full') {
            y = drawSection(ctx, row.section, col1X, y, fullW, themeColor, numColor, fonts) + 15;
        } else {
            const ly = drawColumnSections(ctx, row.left, col1X, y, contentBottom, twoColW, themeColor, numColor, fonts);
            const ry = row.right.length
                ? drawColumnSections(ctx, row.right, col2X, y, contentBottom, twoColW, themeColor, numColor, fonts)
                : y;
            y = Math.max(ly, ry);
        }
    }

    // 제목 + 이벤트 기간 (헤더 중앙, 두 줄)
    if (headerH > 0 && (topText || periodText)) {
        ctx.fillStyle = textColor;
        ctx.font = `400 22px ${fonts.main}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.letterSpacing = '0px';
        if (topText && periodText) {
            ctx.fillText(periodText, W / 2, headerH - 12);
            ctx.fillText(topText, W / 2, headerH - 40);
        } else {
            ctx.fillText(topText || periodText, W / 2, headerH - 12);
        }
    }

    // 기간 우측 텍스트 (헤더 우측 끝, 기간 높이에 우측 정렬)
    if (headerH > 0 && periodNote) {
        ctx.fillStyle = textColor;
        ctx.font = `400 18px ${fonts.main}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.letterSpacing = '0px';
        ctx.fillText(periodNote, W - MARGIN, headerH - 12);
    }


    return canvas;
}

function drawColumnSections(ctx, sections, colX, startY, maxY, colW, themeColor, numColor, fonts) {
    let y = startY;
    for (const sec of sections) {
        if (y >= maxY) break;
        y = drawSection(ctx, sec, colX, y, colW, themeColor, numColor, fonts);
        y += 15;
    }
    return y;
}

function drawSection(ctx, sec, x, startY, colW, themeColor, numColor, fonts) {
    let y = startY;

    // 섹션 헤더 바
    if (sec.title) {
        const HEADER_H = (sec.titleSize || 24) + 16;
        const style = sec.headerStyle || 'filled';
        if (style === 'filled') {
            ctx.fillStyle = themeColor;
            ctx.fillRect(x, y, colW, HEADER_H);
            ctx.fillStyle = '#ffffff';
        } else {
            ctx.fillStyle = '#f8f8f8';
            ctx.fillRect(x, y, colW, HEADER_H);
            ctx.strokeStyle = themeColor;
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 1.5, y + 1.5, colW - 3, HEADER_H - 3);
            ctx.fillStyle = themeColor;
        }
        ctx.font = `700 ${sec.titleSize || 24}px ${fonts.main}`;
        ctx.letterSpacing = '0px';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const _hm = ctx.measureText(sec.title);
        const _textY = y + HEADER_H / 2 + (_hm.actualBoundingBoxAscent - _hm.actualBoundingBoxDescent) / 2;
        ctx.fillText(sec.title, x + colW / 2, _textY);
        y += HEADER_H;
    }

    // 아이템 행
    const itemsStartY = y;
    for (let i = 0; i < sec.items.length; i++) {
        const rowBg = '#ffffff';
        const isLast = i === sec.items.length - 1;
        const nextIsSublabel = !isLast && !!sec.items[i + 1]?.isSublabel;
        y = drawItemRow(ctx, sec.items[i], x, y, colW, themeColor, numColor, rowBg, fonts, isLast || nextIsSublabel, sec.bodySize || 20, sec.numSize || 35);
    }

    // 섹션 아이템 영역 테두리 (4면 균일)
    if (sec.items.length > 0) {
        ctx.strokeStyle = hexToRgba(themeColor, 0.5);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, itemsStartY, colW - 1, y - itemsStartY);
        y += 1;
    }

    return y;
}

function drawItemRow(ctx, item, x, startY, colW, themeColor, numColor, rowBg, fonts, isLast = false, bodySize = 20, numSize = 35) {
    const PAD_X = 18, PAD_Y = 12;
    const NAME_SIZE = bodySize, PRICE_SIZE = 28, NOTE_SIZE = 17;
    const LINE_H = NAME_SIZE * 1.45;

    // 소제목 행
    if (item.isSublabel) {
        const SL_H = 44;
        ctx.fillStyle = hexToRgba(themeColor, 0.13);
        ctx.fillRect(x, startY, colW, SL_H);
        ctx.letterSpacing = '0px';
        // 소제목 텍스트 (DSL 지원)
        const chunks = parseStyledText(item.itemName);
        let cx = x + PAD_X;
        ctx.textBaseline = 'middle';
        for (const chunk of chunks) {
            const sz = Math.max(18, 22 + chunk.sizeDelta * SIZE_STEP);
            ctx.font = `700 ${sz}px ${chunk.boldLevel > 0 ? fonts.bold : fonts.main}`;
            ctx.fillStyle = chunk.isHighlight ? themeColor : hexToRgba(themeColor, 0.85);
            ctx.textAlign = 'left';
            ctx.fillText(chunk.text, cx, startY + SL_H / 2);
            cx += ctx.measureText(chunk.text).width;
        }
        return startY + SL_H;
    }

    // 가격 총 너비 측정 → 이름과 겹치면 스택 강제
    const tiers = buildTiers(item);
    const priceW = measurePriceTiersWidth(ctx, tiers, numSize, fonts);
    // 일반 항목: 50% 너비로 먼저 측정해 멀티라인 여부 판단
    const nameLines_check = wrapStyledText(ctx, item.itemName, Math.floor(colW * 0.50), NAME_SIZE, false, fonts);
    const isStacked = nameLines_check.length > 1 || (tiers.length > 0 && priceW > colW * 0.50 - PAD_X);

    // 스택 모드면 전체 너비로 재측정
    const nameMaxW = isStacked ? Math.floor(colW - PAD_X * 2) : Math.floor(colW * 0.50);
    const nameLines = isStacked
        ? wrapStyledText(ctx, item.itemName, nameMaxW, NAME_SIZE, false, fonts)
        : nameLines_check;
    const nameBlockH = nameLines.length * LINE_H;

    const hasNote = !!item.note;
    const noteH = hasNote ? (NOTE_SIZE * 1.5 + 2) : 0;
    const PRICE_TIER_H = 35;
    const PRICE_ROW_GAP = 6;
    const PRICE_GAP = 1;

    // 스택 모드일 때 멀티행 계산
    const priceAvailW = colW - PAD_X * 2;
    const tierRows = (isStacked && tiers.length) ? packTierRows(ctx, tiers, priceAvailW, numSize, fonts) : [];
    const numPriceRows = tierRows.length || 1;
    const priceTotalH = tiers.length ? (numPriceRows * PRICE_TIER_H + (numPriceRows - 1) * PRICE_ROW_GAP) : PRICE_TIER_H;

    let rowH, priceCenterY, nameStartY;
    if (isStacked) {
        rowH = PAD_Y + Math.ceil(nameBlockH) + PRICE_GAP + priceTotalH + PAD_Y + noteH;
        priceCenterY = startY + PAD_Y + Math.ceil(nameBlockH) + PRICE_GAP + PRICE_TIER_H / 2;
        nameStartY = startY + PAD_Y + LINE_H / 2;
    } else {
        const contentH = Math.ceil(nameBlockH) + PAD_Y * 2 + noteH;
        rowH = Math.max(contentH, 52);
        const priceAreaH = rowH - noteH;
        priceCenterY = startY + priceAreaH / 2;
        nameStartY = startY + priceAreaH / 2 - (nameBlockH - LINE_H) / 2;
    }

    // 배경
    ctx.fillStyle = rowBg;
    ctx.fillRect(x, startY, colW, rowH);

    // 구분선 (양쪽 18px 여백, 마지막 항목 제외)
    if (!isLast) {
        ctx.strokeStyle = themeColor;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x + 18, startY + rowH);
        ctx.lineTo(x + colW - 18, startY + rowH);
        ctx.stroke();
    }

    // 항목명
    ctx.letterSpacing = '0px';
    let ny = nameStartY;
    for (const line of nameLines) {
        let lx = x + PAD_X;
        for (const chunk of line.chunks) {
            ctx.font = chunk.font;
            ctx.fillStyle = chunk.isHighlight ? themeColor : '#1a1a1a';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(chunk.text, lx, ny);
            lx += chunk.width;
        }
        ny += LINE_H;
    }

    // 가격 티어
    const priceRightX = x + colW - PAD_X;
    if (isStacked && tierRows.length > 0) {
        const priceTopY = startY + PAD_Y + Math.ceil(nameBlockH) + PRICE_GAP;
        drawPriceTierRows(ctx, tierRows, priceRightX, priceTopY, themeColor, numColor, fonts, numSize, PRICE_TIER_H, PRICE_ROW_GAP);
    } else {
        drawPriceTiers(ctx, item, priceRightX, priceCenterY, themeColor, numColor, PRICE_SIZE, fonts, numSize);
    }

    // 비고 텍스트 (우하단 작은 글씨)
    if (hasNote) {
        ctx.fillStyle = '#666666';
        ctx.font = `400 ${NOTE_SIZE}px ${fonts.main}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.letterSpacing = '0px';
        ctx.fillText(item.note, x + colW - PAD_X, startY + rowH - noteH + 1);
    }

    return startY + rowH;
}

function buildTiers(item) {
    const tiers = [];
    if (item.prices?.length) {
        item.prices.forEach(p => { if (p.label || p.val) tiers.push({ label: p.label, price: p.val }); });
    } else {
        if (item.p1 || item.p1Label) tiers.push({ label: item.p1Label, price: item.p1 });
        if (item.p2 || item.p2Label) tiers.push({ label: item.p2Label, price: item.p2 });
        if (item.p3 || item.p3Label) tiers.push({ label: item.p3Label, price: item.p3 });
    }
    return tiers;
}

function measureSingleTierWidth(ctx, tier, numSize, fonts) {
    const NUM_SIZE = numSize, UNIT_SIZE = Math.round(numSize * 0.49), CHIP_LABEL_SIZE = 13;
    let w = 0;
    if (tier.price) {
        const { num, unit } = splitPriceText(tier.price);
        if (unit) { ctx.letterSpacing = '0px'; ctx.font = `400 ${UNIT_SIZE}px ${fonts.main}`; w += ctx.measureText(unit).width + 2.5; }
        if (num) { ctx.letterSpacing = '-1.5px'; ctx.font = `700 ${NUM_SIZE}px ${fonts.cheoeumcheoreom}`; w += ctx.measureText(num).width; }
        if (tier.label) w += 10;
    }
    if (tier.label) { ctx.font = `500 ${CHIP_LABEL_SIZE}px ${fonts.medium}`; w += ctx.measureText(tier.label).width + 18; }
    return w;
}

function measurePriceTiersWidth(ctx, tiers, numSize, fonts) {
    if (!tiers.length) return 0;
    const TIER_GAP = 14;
    return tiers.reduce((sum, t, i) => sum + measureSingleTierWidth(ctx, t, numSize, fonts) + (i < tiers.length - 1 ? TIER_GAP : 0), 0);
}

function packTierRows(ctx, tiers, maxW, numSize, fonts) {
    const TIER_GAP = 14;
    // 역방향으로 채워서 뒤집으면 첫 행이 적고 마지막 행이 많은 하단 집중 배치가 됨 (5개 → 2+3)
    const reversed = [...tiers].reverse();
    const rows = [[]];
    let rowW = 0;
    for (const tier of reversed) {
        const tw = measureSingleTierWidth(ctx, tier, numSize, fonts);
        const addW = rows[rows.length - 1].length > 0 ? tw + TIER_GAP : tw;
        if (rows[rows.length - 1].length > 0 && rowW + addW > maxW) {
            rows.push([tier]); rowW = tw;
        } else {
            rows[rows.length - 1].push(tier); rowW += addW;
        }
    }
    return rows.filter(r => r.length > 0).reverse().map(row => row.reverse());
}

function splitPriceText(str) {
    const m = String(str || '').match(/^([\d,\.]+)(.*)/);
    return m ? { num: m[1], unit: m[2] || '' } : { num: '', unit: String(str || '') };
}

function drawPriceTiers(ctx, item, rightX, centerY, themeColor, numColor, fontSize, fonts, numSize = 35) {
    const tiers = [];
    if (item.prices?.length) {
        item.prices.forEach(p => { if (p.label || p.val) tiers.push({ label: p.label, price: p.val }); });
    } else {
        if (item.p1 || item.p1Label) tiers.push({ label: item.p1Label, price: item.p1 });
        if (item.p2 || item.p2Label) tiers.push({ label: item.p2Label, price: item.p2 });
        if (item.p3 || item.p3Label) tiers.push({ label: item.p3Label, price: item.p3 });
    }
    if (!tiers.length) return;

    const NUM_SIZE = numSize, UNIT_SIZE = Math.round(numSize * 0.49), CHIP_LABEL_SIZE = 13;
    const CHIP_H = Math.round(CHIP_LABEL_SIZE * 2);
    const TIER_GAP = 14;
    let x = rightX;
    ctx.letterSpacing = '-1.5px';

    // 숫자 폰트 메트릭으로 baseline 계산 → 숫자 시각적 중앙을 centerY에 정렬
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${NUM_SIZE}px ${fonts.cheoeumcheoreom}`;
    const _nm = ctx.measureText('0');
    const baselineY = centerY + (_nm.actualBoundingBoxAscent - _nm.actualBoundingBoxDescent) / 2;

    for (let i = tiers.length - 1; i >= 0; i--) {
        const tier = tiers[i];
        if (tier.price) {
            const { num, unit } = splitPriceText(tier.price);
            let px = x;
            if (unit) {
                ctx.letterSpacing = '0px';
                ctx.font = `400 ${UNIT_SIZE}px ${fonts.main}`;
                const uw = ctx.measureText(unit).width;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = '#111111';
                ctx.fillText(unit, px, baselineY);
                px -= uw + 2.5;
            }
            if (num) {
                ctx.letterSpacing = '-1.5px';
                ctx.font = `700 ${NUM_SIZE}px ${fonts.cheoeumcheoreom}`;
                const nw = ctx.measureText(num).width;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = numColor;
                ctx.fillText(num, px, baselineY);
                px -= nw;
            }
            x = px - (tier.label ? 10 : 0);
        }
        if (tier.label) {
            ctx.font = `500 ${CHIP_LABEL_SIZE}px ${fonts.medium}`;
            const lw = ctx.measureText(tier.label).width;
            const chipW = lw + 18;
            const chipX = x - chipW;
            ctx.fillStyle = themeColor;
            roundRect(ctx, chipX, centerY - CHIP_H / 2, chipW, CHIP_H, CHIP_H / 2);
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tier.label, chipX + chipW / 2, centerY);
            x = chipX - (i > 0 ? TIER_GAP : 0);
        } else if (i > 0) {
            x -= TIER_GAP;
        }
    }
}

function drawPriceTierRows(ctx, tierRows, rightX, topY, themeColor, numColor, fonts, numSize, TIER_H = 35, ROW_GAP = 6) {
    const NUM_SIZE = numSize, UNIT_SIZE = Math.round(numSize * 0.49), CHIP_LABEL_SIZE = 13;
    const CHIP_H = Math.round(CHIP_LABEL_SIZE * 2);
    const TIER_GAP = 14;

    for (let ri = 0; ri < tierRows.length; ri++) {
        const row = tierRows[ri];
        const centerY = topY + ri * (TIER_H + ROW_GAP) + TIER_H / 2;

        ctx.textBaseline = 'alphabetic';
        ctx.font = `700 ${NUM_SIZE}px ${fonts.cheoeumcheoreom}`;
        const _nm = ctx.measureText('0');
        const baselineY = centerY + (_nm.actualBoundingBoxAscent - _nm.actualBoundingBoxDescent) / 2;

        let x = rightX;
        ctx.letterSpacing = '-1.5px';
        for (let i = row.length - 1; i >= 0; i--) {
            const tier = row[i];
            if (tier.price) {
                const { num, unit } = splitPriceText(tier.price);
                let px = x;
                if (unit) {
                    ctx.letterSpacing = '0px'; ctx.font = `400 ${UNIT_SIZE}px ${fonts.main}`;
                    const uw = ctx.measureText(unit).width;
                    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#111111';
                    ctx.fillText(unit, px, baselineY); px -= uw + 2.5;
                }
                if (num) {
                    ctx.letterSpacing = '-1.5px'; ctx.font = `700 ${NUM_SIZE}px ${fonts.cheoeumcheoreom}`;
                    const nw = ctx.measureText(num).width;
                    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = numColor;
                    ctx.fillText(num, px, baselineY); px -= nw;
                }
                x = px - (tier.label ? 10 : 0);
            }
            if (tier.label) {
                ctx.font = `500 ${CHIP_LABEL_SIZE}px ${fonts.medium}`;
                const lw = ctx.measureText(tier.label).width;
                const chipW = lw + 18;
                const chipX = x - chipW;
                ctx.fillStyle = themeColor;
                roundRect(ctx, chipX, centerY - CHIP_H / 2, chipW, CHIP_H, CHIP_H / 2);
                ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(tier.label, chipX + chipW / 2, centerY);
                x = chipX - (i > 0 ? TIER_GAP : 0);
            } else if (i > 0) {
                x -= TIER_GAP;
            }
        }
    }
}

/* ============================================================
 * 이미지 생성 (DOM 파싱 → 캔버스)
 * ============================================================ */
function parseDomToPages() {
    const pages = [];

    function getPage() {
        if (!pages.length) pages.push({ rows: [] });
        return pages[pages.length - 1];
    }

    let currentSplit = null; // { type:'split', left:[], right:[] }
    let currentSide = 'left';
    let currentSection = null;

    function flushSection() {
        if (!currentSection || (!currentSection.title && !currentSection.items.length)) return;
        if (currentSection.isFullWidth) {
            flushSplit();
            getPage().rows.push({ type: 'full', section: currentSection });
        } else {
            if (!currentSplit) currentSplit = { type: 'split', left: [], right: [] };
            currentSplit[currentSide].push(currentSection);
        }
        currentSection = null;
    }

    function flushSplit() {
        if (!currentSplit) return;
        if (currentSplit.left.length || currentSplit.right.length) {
            getPage().rows.push(currentSplit);
        }
        currentSplit = null;
        currentSide = 'left';
    }

    const children = Array.from(document.getElementById('itemsContainer').children)
        .filter(n => !n.classList.contains('items-empty-hint'));

    for (const node of children) {
        if (node.classList.contains('column-break-wrapper')) {
            flushSection();
            currentSide = 'right';
        } else if (node.classList.contains('section-title-wrapper')) {
            flushSection();
            currentSection = {
                title: node.querySelector('.section-title-input')?.value.trim() || '',
                titleSize: parseInt(node.querySelector('.js-title-size-display')?.textContent) || 24,
                bodySize: parseInt(node.querySelector('.js-body-size-display')?.textContent) || 20,
                numSize: parseInt(node.querySelector('.js-num-size-display')?.textContent) || 35,
                isFullWidth: node.dataset.fullWidth === 'true',
                items: []
            };
        } else if (node.classList.contains('item-row')) {
            if (!currentSection) {
                currentSection = { title: '', titleSize: 24, bodySize: 20, numSize: 35, isFullWidth: false, items: [] };
            }
            currentSection.items.push({
                itemName: node.querySelector('.item-name')?.value || '',
                isSublabel: node.querySelector('.item-sublabel')?.checked || false,
                prices: readPriceSlots(node),
                note: node.querySelector('.item-note-input')?.value || ''
            });
        }
    }

    flushSection();
    flushSplit();

    return pages.filter(p => p.rows.length > 0);
}

function autoBalancePage(page) {
    page.rows.forEach(row => {
        if (row.type !== 'split' || row.right.length > 0 || row.left.length < 2) return;
        const mid = Math.ceil(row.left.length / 2);
        row.right = row.left.slice(mid);
        row.left = row.left.slice(0, mid);
    });
}

function generateImages() {
    const pages = parseDomToPages();
    pages.forEach(autoBalancePage);
    const previewContainer = document.getElementById('previewContainer');
    const statusChip = document.getElementById('statusChip');

    if (pages.length === 0) {
        previewContainer.innerHTML = `<div class="placeholder-text" id="placeholder"><p style="font-size:40px;margin-bottom:16px;">📄</p>A4 출력 이미지가 여기에 표시됩니다.<br><span style="font-size:13px;color:#ABB3BB;">섹션과 항목을 추가해 시작하세요</span></div>`;
        generatedImagesUrls = [];
        if (statusChip) { statusChip.textContent = ''; statusChip.className = 'status-chip'; }
        return;
    }

    if (statusChip) { statusChip.textContent = '생성 중…'; statusChip.className = 'status-chip generating'; }

    const themeColor = document.getElementById('themeHex')?.value || '#000000';
    const numColor = document.getElementById('numColorHex')?.value || '#000000';
    const headerRatio = (parseInt(document.getElementById('headerHeight')?.value || '28', 10)) / 100;
    const topText = document.getElementById('topText')?.value || '';
    const periodText = document.getElementById('periodText')?.value || '';
    const periodNote = document.getElementById('periodNote')?.value || '';
    const textColor = document.getElementById('textColorHex')?.value || '#000000';
    const textScale = (parseInt(document.getElementById('textScale')?.value || '100', 10)) / 100;

    requestAnimationFrame(() => {
        // 컬럼 구분선이 있을 때만 2컬럼, 없으면 전체 너비 1열로 렌더링
        if (textScale !== 1) {
            pages.forEach(page => {
                page.rows.forEach(row => {
                    const secs = row.type === 'full' ? [row.section] : [...row.left, ...row.right];
                    secs.forEach(sec => {
                        sec.titleSize = Math.round((sec.titleSize || 24) * textScale);
                        sec.bodySize  = Math.round((sec.bodySize  || 20) * textScale);
                        sec.numSize   = Math.round((sec.numSize   || 35) * textScale);
                    });
                });
            });
        }
        const canvases = pages.map(page =>
            drawA4Canvas(cachedBgImg, page.rows, headerRatio, themeColor, numColor, topText, periodText, textColor, periodNote)
        );

        generatedImagesUrls = canvases.map(c => c.toDataURL('image/jpeg', 0.95));

        previewContainer.innerHTML = '';
        generatedImagesUrls.forEach((url, i) => {
            const img = document.createElement('img');
            img.src = url;
            img.alt = `A4 이미지 ${i + 1}`;
            previewContainer.appendChild(img);
        });

        if (statusChip) {
            statusChip.textContent = `${pages.length}페이지 완료`;
            statusChip.className = 'status-chip done';
        }
    });
}

let _genTimer = null;
function debouncedGenerateImages() {
    clearTimeout(_genTimer);
    _genTimer = setTimeout(generateImages, 300);
}

/* ============================================================
 * 색상 프리셋
 * ============================================================ */
/* ── 미니 커스텀 슬롯 (숫자색/텍스트색) ── */
const MINI_PRESET_META = {
    numColorPresets: {
        storageKey: 'a4NumColorSlots',
        getColor: () => document.getElementById('numColorHex')?.value || '#000000',
        apply: c => { updateNumColorSync(c); saveSnapshot(); debouncedGenerateImages(); }
    },
    textColorPresets: {
        storageKey: 'a4TextColorSlots',
        getColor: () => document.getElementById('textColorHex')?.value || '#000000',
        apply: c => { updateTextColorSync(c); saveSnapshot(); debouncedGenerateImages(); }
    }
};
function loadMiniSlots(storageKey) {
    try {
        const s = JSON.parse(localStorage.getItem(storageKey));
        if (Array.isArray(s) && s.length <= 6 && s.every(c => /^#[0-9A-Fa-f]{6}$/.test(c))) return s;
    } catch(e) {}
    return [];
}
function saveMiniSlots(storageKey, slots) { localStorage.setItem(storageKey, JSON.stringify(slots)); }
function renderMiniColorPresets(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const meta = MINI_PRESET_META[containerId];
    if (!meta) return;
    const slots = loadMiniSlots(meta.storageKey);
    el.innerHTML = '';
    const area = document.createElement('div');
    area.className = 'preset-custom-area';
    if (slots.length < 6) {
        const add = document.createElement('button');
        add.className = 'preset-add-btn';
        add.dataset.miniAdd = containerId;
        add.title = '현재 색상 저장 (최대 6개)';
        add.textContent = '+';
        area.appendChild(add);
    }
    if (slots.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'color-preset-hint';
        hint.textContent = '커스텀 저장';
        area.appendChild(hint);
    }
    slots.forEach((color, i) => {
        const btn = document.createElement('button');
        btn.className = 'preset-swatch';
        btn.dataset.miniColor = color;
        btn.dataset.miniId = containerId;
        btn.dataset.miniIdx = String(i);
        btn.title = color;
        btn.style.backgroundColor = color;
        const del = document.createElement('span');
        del.className = 'swatch-delete';
        del.dataset.miniDel = String(i);
        del.dataset.miniId = containerId;
        del.textContent = '×';
        btn.appendChild(del);
        area.appendChild(btn);
    });
    el.appendChild(area);
}
function initMiniPresetHandlers() {
    document.addEventListener('click', e => {
        // + 저장
        if (e.target.dataset.miniAdd) {
            const id = e.target.dataset.miniAdd;
            const meta = MINI_PRESET_META[id];
            if (!meta) return;
            const color = meta.getColor().toUpperCase();
            const slots = loadMiniSlots(meta.storageKey);
            if (slots.length >= 6) return showColorToast('최대 6개까지 저장 가능합니다');
            if (!slots.includes(color)) {
                slots.push(color); saveMiniSlots(meta.storageKey, slots);
                renderMiniColorPresets(id); showColorToast('색상이 저장되었습니다');
            } else showColorToast('이미 저장된 색상입니다');
            return;
        }
        // × 삭제
        if (e.target.dataset.miniDel !== undefined && e.target.dataset.miniId) {
            e.stopPropagation();
            const id = e.target.dataset.miniId;
            const meta = MINI_PRESET_META[id];
            if (!meta) return;
            const slots = loadMiniSlots(meta.storageKey);
            slots.splice(parseInt(e.target.dataset.miniDel), 1);
            saveMiniSlots(meta.storageKey, slots);
            renderMiniColorPresets(id);
            return;
        }
        // 스와치 클릭 → 색상 적용
        const swatch = e.target.closest('[data-mini-color]');
        if (swatch && !e.target.dataset.miniDel) {
            const id = swatch.dataset.miniId;
            const meta = MINI_PRESET_META[id];
            if (meta) meta.apply(swatch.dataset.miniColor);
        }
    });
}

function loadColorSlots() {
    try {
        const saved = JSON.parse(localStorage.getItem('a4ColorSlots'));
        if (Array.isArray(saved) && saved.length <= 6 && saved.every(c => /^#[0-9A-Fa-f]{6}$/.test(c))) return saved;
    } catch(e) {}
    return [];
}
function saveColorSlots(slots) { localStorage.setItem('a4ColorSlots', JSON.stringify(slots)); }
function renderColorPresets() {
    const container = document.getElementById('colorPresets');
    if (!container) return;
    const customSlots = loadColorSlots();
    const current = (document.getElementById('themeHex')?.value || '').toUpperCase();
    container.innerHTML = '';

    // 빌트인 프리셋 카드 그리드
    const grid = document.createElement('div');
    grid.className = 'preset-card-grid';
    BUILTIN_PRESETS.forEach(({ color, name }) => {
        const btn = document.createElement('button');
        btn.className = 'preset-card' + (color.toUpperCase() === current ? ' active' : '');
        btn.setAttribute('data-color', color);
        btn.innerHTML = `<span class="preset-card-swatch" style="background:${color}"></span><span class="preset-card-name">${escapeHtml(name)}</span>`;
        grid.appendChild(btn);
    });
    container.appendChild(grid);

    // 커스텀 저장 색상
    const customArea = document.createElement('div');
    customArea.className = 'preset-custom-area';
    if (customSlots.length < 6) {
        const add = document.createElement('button');
        add.className = 'preset-add-btn'; add.id = 'presetAddBtn';
        add.title = '현재 색상 저장 (최대 6개)'; add.textContent = '+';
        customArea.appendChild(add);
    }
    if (customSlots.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'color-preset-hint'; hint.textContent = '커스텀 저장';
        customArea.appendChild(hint);
    }
    customSlots.forEach((color, i) => {
        const btn = document.createElement('button');
        btn.className = 'preset-swatch' + (color.toUpperCase() === current ? ' active' : '');
        btn.setAttribute('data-color', color); btn.setAttribute('data-slot', String(i));
        btn.title = color; btn.style.backgroundColor = color;
        const del = document.createElement('span');
        del.className = 'swatch-delete'; del.setAttribute('data-delete', String(i)); del.textContent = '×';
        btn.appendChild(del);
        customArea.appendChild(btn);
    });
    container.appendChild(customArea);
}
function syncPresetActive(color) {
    const upper = color.toUpperCase();
    document.querySelectorAll('.preset-swatch').forEach(s => s.classList.toggle('active', s.dataset.color?.toUpperCase() === upper));
    document.querySelectorAll('.preset-card').forEach(s => s.classList.toggle('active', s.dataset.color?.toUpperCase() === upper));
}
function showColorToast(msg) {
    let toast = document.getElementById('colorToast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'colorToast'; document.body.appendChild(toast); }
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => toast.classList.remove('show'), 1800);
}

/* ============================================================
 * 색상 동기화
 * ============================================================ */
function updateColorSync(hex) {
    const upper = hex.toUpperCase();
    const colorPicker = document.getElementById('themeColor');
    const hexInput = document.getElementById('themeHex');
    const swatch = document.getElementById('themeSwatch');
    if (colorPicker) colorPicker.value = upper;
    if (hexInput) hexInput.value = upper;
    if (swatch) swatch.style.backgroundColor = upper;
    syncPresetActive(upper);
    document.documentElement.style.setProperty('--h1-bar-color', upper);
}

function updateTextColorSync(hex) {
    const upper = hex.toUpperCase();
    const picker = document.getElementById('textColorPicker');
    const hexInput = document.getElementById('textColorHex');
    const swatch = document.getElementById('textColorSwatch');
    if (picker) picker.value = upper;
    if (hexInput) hexInput.value = upper;
    if (swatch) swatch.style.backgroundColor = upper;
}

function updateNumColorSync(hex) {
    const upper = hex.toUpperCase();
    const picker = document.getElementById('numColorPicker');
    const hexInput = document.getElementById('numColorHex');
    const swatch = document.getElementById('numColorSwatch');
    if (picker) picker.value = upper;
    if (hexInput) hexInput.value = upper;
    if (swatch) swatch.style.backgroundColor = upper;
}

function updateSliderBg(slider) {
    const val = slider.value, min = slider.min || 0, max = slider.max || 100;
    const pct = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--primary) 0%, var(--primary) ${pct}%, #E5E8EB ${pct}%, #E5E8EB 100%)`;
}

/* ============================================================
 * 배경 이미지 표시
 * ============================================================ */
function showBgThumb(src) {
    const thumb = document.getElementById('bgThumb');
    if (thumb) { thumb.src = src; thumb.classList.add('visible'); }
    const sub = document.getElementById('fileLabelSub');
    if (sub) sub.textContent = '배경 이미지 로드됨';
}
function hideBgThumb() {
    const thumb = document.getElementById('bgThumb');
    if (thumb) { thumb.src = ''; thumb.classList.remove('visible'); }
    const sub = document.getElementById('fileLabelSub');
    if (sub) sub.textContent = '';
}

/* ============================================================
 * 프로젝트 저장 / 불러오기
 * ============================================================ */
function saveProject() {
    const data = getSnapshot();
    if (cachedBgImg?.src?.startsWith('data:')) {
        data.bgImage = cachedBgImg.src;
    }
    const now = new Date();
    const dateStr = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    const timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' });
    saveAs(blob, `A4이벤트_백업_${dateStr}_${timeStr}.json`);
    markSaved();
}

function loadProject(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            restoreSnapshot(data);
            if (data.bgImage) {
                const img = new Image();
                img.src = data.bgImage;
                img.onload = () => { cachedBgImg = img; showBgThumb(data.bgImage); generateImages(); markSaved(); };
                showColorToast('불러오기 완료. 배경 이미지도 함께 복원되었습니다.');
            } else {
                showColorToast('불러오기 완료. 배경 이미지는 별도로 다시 선택해 주세요.');
                generateImages();
                markSaved();
            }
        } catch(err) { alert('잘못된 백업 파일입니다.'); }
    };
    reader.readAsText(file);
    event.target.value = '';
}

/* ============================================================
 * 다운로드
 * ============================================================ */
function downloadImages() {
    if (!generatedImagesUrls.length) return showColorToast('먼저 섹션과 항목을 추가해 이미지를 생성해 주세요.');
    if (generatedImagesUrls.length === 1) {
        const a = document.createElement('a');
        a.href = generatedImagesUrls[0]; a.download = 'A4이벤트_01.jpg';
        document.body.appendChild(a); a.click(); a.remove();
    } else {
        const zip = new JSZip();
        const now = new Date();
        const ds = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
        generatedImagesUrls.forEach((url, i) => {
            zip.file(String(i + 1).padStart(2, '0') + '.jpg', url.replace(/^data:image\/(png|jpeg);base64,/, ''), { base64: true });
        });
        zip.generateAsync({ type: 'blob' }).then(content => saveAs(content, `A4이벤트_${ds}.zip`));
    }
}

/* ============================================================
 * 전체 펼치기 / 접기
 * ============================================================ */
let isAllCollapsed = false;
function toggleAllSections() {
    isAllCollapsed = !isAllCollapsed;
    const btn = document.getElementById('btnToggleAll');
    if (btn) btn.textContent = isAllCollapsed ? '모두 펼치기' : '모두 접기';
    document.querySelectorAll('#itemsContainer .section-title-wrapper').forEach(node => {
        node.classList.toggle('collapsed', isAllCollapsed);
    });
    refreshAccordionVisibility();
    refreshBookmarks();
    saveSnapshot();
}

/* ============================================================
 * 초기화
 * ============================================================ */
window.onload = () => {
    // 탭 전환
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(tab === 'design' ? 'tabDesign' : 'tabItems').classList.add('active');
        });
    });

    // 색상 설정
    const colorPicker = document.getElementById('themeColor');
    const hexInput = document.getElementById('themeHex');
    const swatch = document.getElementById('themeSwatch');

    colorPicker.addEventListener('input', e => {
        const c = e.target.value;
        hexInput.value = c.toUpperCase();
        swatch.style.backgroundColor = c;
        syncPresetActive(c);
        document.documentElement.style.setProperty('--h1-bar-color', c);
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    hexInput.addEventListener('input', e => {
        let c = e.target.value;
        if (!c.startsWith('#')) c = '#' + c;
        if (/^#[0-9A-F]{6}$/i.test(c)) {
            hexInput.value = c.toUpperCase();
            colorPicker.value = c;
            swatch.style.backgroundColor = c;
            syncPresetActive(c);
            document.documentElement.style.setProperty('--h1-bar-color', c);
            debouncedGenerateImages();
        }
    });
    swatch.addEventListener('click', () => colorPicker.click());
    [colorPicker, hexInput].forEach(el => {
        el.addEventListener('focus', () => { el._before = el.value; });
        el.addEventListener('blur', () => { if (el._before !== el.value) saveSnapshot(); });
    });

    // 숫자 색상
    const numColorPicker = document.getElementById('numColorPicker');
    const numColorHex = document.getElementById('numColorHex');
    const numColorSwatch = document.getElementById('numColorSwatch');
    numColorPicker.addEventListener('input', e => {
        const c = e.target.value;
        numColorHex.value = c.toUpperCase();
        numColorSwatch.style.backgroundColor = c;
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    numColorHex.addEventListener('input', e => {
        let c = e.target.value;
        if (!c.startsWith('#')) c = '#' + c;
        if (/^#[0-9A-F]{6}$/i.test(c)) {
            numColorHex.value = c.toUpperCase();
            numColorPicker.value = c;
            numColorSwatch.style.backgroundColor = c;
            debouncedGenerateImages();
        }
    });
    numColorSwatch.addEventListener('click', () => numColorPicker.click());
    [numColorPicker, numColorHex].forEach(el => {
        el.addEventListener('focus', () => { el._before = el.value; });
        el.addEventListener('blur', () => { if (el._before !== el.value) saveSnapshot(); });
    });

    // 슬라이더
    const slider = document.getElementById('headerHeight');
    slider.addEventListener('input', () => {
        document.getElementById('headerHeightLabel').value = slider.value;
        updateSliderBg(slider);
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    updateSliderBg(slider);

    const headerHeightInput = document.getElementById('headerHeightLabel');
    headerHeightInput.addEventListener('input', () => {
        let v = parseInt(headerHeightInput.value);
        if (isNaN(v)) return;
        v = Math.min(Math.max(v, 0), 55);
        slider.value = v;
        updateSliderBg(slider);
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    headerHeightInput.addEventListener('blur', () => {
        let v = parseInt(headerHeightInput.value);
        if (isNaN(v)) v = 28;
        v = Math.min(Math.max(v, 0), 55);
        headerHeightInput.value = v;
        slider.value = v;
        updateSliderBg(slider);
        saveSnapshot();
    });

    // 전체 텍스트 크기 슬라이더
    const textScaleSlider = document.getElementById('textScale');
    textScaleSlider.addEventListener('input', () => {
        document.getElementById('textScaleLabel').value = textScaleSlider.value;
        updateSliderBg(textScaleSlider);
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    updateSliderBg(textScaleSlider);

    const textScaleInput = document.getElementById('textScaleLabel');
    textScaleInput.addEventListener('input', () => {
        let v = parseInt(textScaleInput.value);
        if (isNaN(v)) return;
        v = Math.min(Math.max(v, 70), 150);
        textScaleSlider.value = v;
        updateSliderBg(textScaleSlider);
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    textScaleInput.addEventListener('blur', () => {
        let v = parseInt(textScaleInput.value);
        if (isNaN(v)) v = 100;
        v = Math.min(Math.max(v, 70), 150);
        textScaleInput.value = v;
        textScaleSlider.value = v;
        updateSliderBg(textScaleSlider);
        saveSnapshot();
    });

    // 텍스트 색상 피커
    const textColorPicker = document.getElementById('textColorPicker');
    const textColorHex = document.getElementById('textColorHex');
    const textColorSwatch = document.getElementById('textColorSwatch');
    textColorPicker.addEventListener('input', e => {
        const c = e.target.value;
        textColorHex.value = c.toUpperCase();
        textColorSwatch.style.backgroundColor = c;
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    textColorHex.addEventListener('input', e => {
        let c = e.target.value;
        if (!c.startsWith('#')) c = '#' + c;
        if (/^#[0-9A-F]{6}$/i.test(c)) {
            textColorHex.value = c.toUpperCase();
            textColorPicker.value = c;
            textColorSwatch.style.backgroundColor = c;
            debouncedGenerateImages();
        }
    });
    textColorSwatch.addEventListener('click', () => textColorPicker.click());
    [textColorPicker, textColorHex].forEach(el => {
        el.addEventListener('focus', () => { el._before = el.value; });
        el.addEventListener('blur', () => { if (el._before !== el.value) saveSnapshot(); });
    });

    // 상단 텍스트
    const topInput = document.getElementById('topText');
    topInput.addEventListener('input', () => { debouncedGenerateImages(); handleInputSnapshot(); });
    topInput.addEventListener('focus', () => { topInput._before = topInput.value; });
    topInput.addEventListener('blur', () => { if (topInput._before !== topInput.value) saveSnapshot(); });

    // 이벤트 기간
    const periodInput = document.getElementById('periodText');
    periodInput.addEventListener('input', () => { debouncedGenerateImages(); handleInputSnapshot(); });
    periodInput.addEventListener('focus', () => { periodInput._before = periodInput.value; });
    periodInput.addEventListener('blur', () => { if (periodInput._before !== periodInput.value) saveSnapshot(); });

    // 기간 우측 텍스트
    const periodNoteInput = document.getElementById('periodNote');
    periodNoteInput.addEventListener('input', () => { debouncedGenerateImages(); handleInputSnapshot(); });
    periodNoteInput.addEventListener('focus', () => { periodNoteInput._before = periodNoteInput.value; });
    periodNoteInput.addEventListener('blur', () => { if (periodNoteInput._before !== periodNoteInput.value) saveSnapshot(); });


    // 배경 이미지
    const bgInput = document.getElementById('bgInput');
    bgInput.addEventListener('change', e => {
        if (!e.target.files?.length) { cachedBgImg = null; hideBgThumb(); debouncedGenerateImages(); return; }
        const file = e.target.files[0];
        if (file.size > 20 * 1024 * 1024) { alert('이미지 파일 크기는 20MB 이하로 선택해 주세요.'); e.target.value = ''; return; }
        saveSnapshot();
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image();
            img.src = ev.target.result;
            img.onload = () => { cachedBgImg = img; showBgThumb(ev.target.result); debouncedGenerateImages(); };
        };
        reader.readAsDataURL(file);
        document.getElementById('fileLabelMain').textContent = file.name;
        document.getElementById('dropZone').classList.add('file-attached');
    });
    document.getElementById('dropZone').addEventListener('click', () => bgInput.click());
    document.getElementById('dropZone').addEventListener('dragover', e => { e.preventDefault(); document.getElementById('dropZone').classList.add('file-attached'); });
    document.getElementById('dropZone').addEventListener('dragleave', () => { if (!cachedBgImg) document.getElementById('dropZone').classList.remove('file-attached'); });
    document.getElementById('dropZone').addEventListener('drop', e => {
        e.preventDefault(); saveSnapshot();
        const file = e.dataTransfer.files[0];
        if (!file?.type.startsWith('image/')) return;
        if (file.size > 20 * 1024 * 1024) { alert('이미지 파일 크기는 20MB 이하로 선택해 주세요.'); return; }
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image(); img.src = ev.target.result;
            img.onload = () => { cachedBgImg = img; showBgThumb(ev.target.result); debouncedGenerateImages(); };
        };
        reader.readAsDataURL(file);
        document.getElementById('fileLabelMain').textContent = file.name;
        document.getElementById('dropZone').classList.add('file-attached');
    });

    // 항목 추가 버튼
    document.getElementById('addSectionBtn').addEventListener('click', () => { saveSnapshot(); addSectionTitle(); });
    document.getElementById('addItemBtn').addEventListener('click', () => { saveSnapshot(); addItemRow(); });
    document.getElementById('addColumnBreakBtn').addEventListener('click', () => { saveSnapshot(); addColumnBreak(); });
    document.getElementById('btnToggleAll').addEventListener('click', toggleAllSections);

    // itemsContainer 이벤트 위임
    const container = document.getElementById('itemsContainer');
    container.addEventListener('input', e => {
        const t = e.target;
        if (t.matches('.btn-input')) {
            if (t.tagName === 'TEXTAREA') autoResizeTextarea(t);
            if (t.classList.contains('section-title-input') || t.classList.contains('item-name')) updateViolationUI(t);
            debouncedGenerateImages();
            handleInputSnapshot();
        }
    });
    container.addEventListener('mousedown', e => {
        const btn = e.target.closest('.fmt-btn');
        if (!btn) return;
        e.preventDefault();
        const ta = btn.closest('.item-name-wrapper')?.querySelector('.item-name, .section-title-input');
        if (!ta) return;
        const open = btn.dataset.open, close = btn.dataset.close;
        const s = ta.selectionStart, end = ta.selectionEnd;
        const sel = ta.value.substring(s, end);
        ta.value = ta.value.substring(0, s) + open + sel + close + ta.value.substring(end);
        const cursor = sel ? s + open.length + sel.length + close.length : s + open.length;
        ta.setSelectionRange(cursor, cursor);
        ta.focus();
        autoResizeTextarea(ta);
        updateViolationUI(ta);
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    container.addEventListener('focusin', e => {
        if (e.target.matches('.btn-input')) { e.target._before = e.target.value; updateViolationUI(e.target); }
    });
    container.addEventListener('focusout', e => {
        if (e.target.matches('.btn-input') && e.target._before !== e.target.value) saveSnapshot();
    });
    container.addEventListener('paste', e => {
        if (e.target.matches('.btn-input')) setTimeout(() => { updateViolationUI(e.target); saveSnapshot(); }, 0);
    });
    container.addEventListener('click', e => {
        // 가격 슬롯 추가
        if (e.target.closest('.js-add-price-slot')) {
            const row = e.target.closest('.item-row');
            const wrap = row.querySelector('.price-slots-wrap');
            wrap.appendChild(buildPriceSlotEl(wrap.querySelectorAll('.price-slot').length + 1, '', ''));
            renumberPriceSlots(row);
            debouncedGenerateImages(); handleInputSnapshot(); return;
        }
        // 가격 슬롯 복제
        if (e.target.closest('.js-dup-price-slot')) {
            const slot = e.target.closest('.price-slot');
            const row = e.target.closest('.item-row');
            const wrap = row.querySelector('.price-slots-wrap');
            const label = slot.querySelector('.price-label-input')?.value || '';
            const val = slot.querySelector('.price-val-input')?.value || '';
            const newSlot = buildPriceSlotEl(wrap.querySelectorAll('.price-slot').length + 1, label, val);
            slot.insertAdjacentElement('afterend', newSlot);
            renumberPriceSlots(row);
            debouncedGenerateImages(); handleInputSnapshot(); return;
        }
        // 가격 슬롯 삭제
        if (e.target.closest('.js-remove-price-slot')) {
            const row = e.target.closest('.item-row');
            const wrap = row.querySelector('.price-slots-wrap');
            if (wrap.querySelectorAll('.price-slot').length > 1) {
                e.target.closest('.price-slot').remove();
                renumberPriceSlots(row);
            }
            debouncedGenerateImages(); handleInputSnapshot(); return;
        }
        // 섹션 삭제
        if (e.target.closest('.js-del-section')) {
            saveSnapshot();
            const wrapper = e.target.closest('.section-title-wrapper');
            let next = wrapper.nextElementSibling;
            while (next?.classList.contains('item-row')) { const tmp = next.nextElementSibling; next.remove(); next = tmp; }
            wrapper.remove(); refreshAccordionVisibility(); debouncedGenerateImages(); return;
        }
        // 섹션 복제
        if (e.target.closest('.js-dup-section')) {
            saveSnapshot();
            const wrapper = e.target.closest('.section-title-wrapper');
            const titleVal = wrapper.querySelector('.section-title-input')?.value || '';
            const dupTitleSize = parseInt(wrapper.querySelector('.js-title-size-display')?.textContent) || 24;
            const dupBodySize = parseInt(wrapper.querySelector('.js-body-size-display')?.textContent) || 20;
            const dupNumSize = parseInt(wrapper.querySelector('.js-num-size-display')?.textContent) || 35;
            const items = [];
            let next = wrapper.nextElementSibling;
            while (next?.classList.contains('item-row')) {
                items.push({
                    itemName: next.querySelector('.item-name')?.value || '',
                    isSublabel: next.querySelector('.item-sublabel')?.checked || false,
                    prices: readPriceSlots(next),
                    note: next.querySelector('.item-note-input')?.value || ''
                });
                next = next.nextElementSibling;
            }
            // next = 원본 섹션 직후의 비(非)아이템 노드. null이면 맨 끝.
            // addSectionTitle/addItemRow 는 항상 끝에 추가하므로, 추가 후 올바른 위치로 이동.
            const dupFullWidth = wrapper.dataset.fullWidth === 'true';
            addSectionTitle(titleVal, false, null, dupTitleSize, dupBodySize, dupNumSize, dupFullWidth);
            if (next) container.insertBefore(container.lastElementChild, next);
            items.forEach(item => {
                addItemRow(item);
                if (next) container.insertBefore(container.lastElementChild, next);
            });
            refreshAccordionVisibility();
            return;
        }
        // 항목 삭제
        if (e.target.closest('.js-del-item')) {
            saveSnapshot();
            e.target.closest('.item-row').remove();
            refreshAccordionVisibility(); debouncedGenerateImages(); return;
        }
        // 항목 복제
        if (e.target.closest('.js-dup-item')) {
            saveSnapshot();
            const row = e.target.closest('.item-row');
            const nextSibling = row.nextElementSibling;
            addItemRow({
                itemName: row.querySelector('.item-name')?.value || '',
                isSublabel: row.querySelector('.item-sublabel')?.checked || false,
                prices: readPriceSlots(row),
                note: row.querySelector('.item-note-input')?.value || ''
            });
            if (nextSibling) container.insertBefore(container.lastElementChild, nextSibling);
            refreshAccordionVisibility();
            return;
        }
        // 컬럼 구분 삭제
        if (e.target.closest('.js-del-colbreak')) {
            saveSnapshot(); e.target.closest('.column-break-wrapper').remove();
            refreshAccordionVisibility(); debouncedGenerateImages(); return;
        }
        // 섹션 옵션 토글
        if (e.target.closest('.js-toggle-sec-opts')) {
            const row = e.target.closest('.section-title-wrapper')?.querySelector('.section-opts-row');
            if (row) row.classList.toggle('open');
        }
        // 레이아웃 토글 (2열 / 전체폭)
        if (e.target.closest('.js-layout-split') || e.target.closest('.js-layout-full')) {
            const isFull = !!e.target.closest('.js-layout-full');
            const wrapper = e.target.closest('.section-title-wrapper');
            if (wrapper) {
                wrapper.dataset.fullWidth = isFull ? 'true' : 'false';
                wrapper.querySelector('.js-layout-split').classList.toggle('layout-btn-active', !isFull);
                wrapper.querySelector('.js-layout-full').classList.toggle('layout-btn-active', isFull);
                saveSnapshot(); debouncedGenerateImages();
            }
        }
        // 비고 드롭다운 토글
        if (e.target.closest('.js-toggle-note')) {
            const btn = e.target.closest('.js-toggle-note');
            const itemRow = btn.closest('.item-row');
            const noteRow = itemRow.querySelector('.item-note-row');
            const isNowHidden = noteRow.classList.toggle('hidden');
            btn.classList.toggle('btn-action-active', !isNowHidden);
            if (!isNowHidden) noteRow.querySelector('.item-note-input').focus();
            return;
        }
    });
    container.addEventListener('click', e => {
        const isTitleMinus = e.target.closest('.js-title-size-minus');
        const isTitlePlus  = e.target.closest('.js-title-size-plus');
        const isBodyMinus  = e.target.closest('.js-body-size-minus');
        const isBodyPlus   = e.target.closest('.js-body-size-plus');
        if (isTitleMinus || isTitlePlus) {
            const display = e.target.closest('.section-title-wrapper').querySelector('.js-title-size-display');
            let val = parseInt(display.textContent) || 24;
            val = Math.min(Math.max(val + (isTitlePlus ? 1 : -1), 14), 40);
            display.textContent = val;
            debouncedGenerateImages(); saveSnapshot();
        }
        if (isBodyMinus || isBodyPlus) {
            const display = e.target.closest('.section-title-wrapper').querySelector('.js-body-size-display');
            let val = parseInt(display.textContent) || 20;
            val = Math.min(Math.max(val + (isBodyPlus ? 1 : -1), 12), 32);
            display.textContent = val;
            debouncedGenerateImages(); saveSnapshot();
        }
        const isNumMinus = e.target.closest('.js-num-size-minus');
        const isNumPlus  = e.target.closest('.js-num-size-plus');
        if (isNumMinus || isNumPlus) {
            const display = e.target.closest('.section-title-wrapper').querySelector('.js-num-size-display');
            let val = parseInt(display.textContent) || 35;
            val = Math.min(Math.max(val + (isNumPlus ? 1 : -1), 20), 60);
            display.textContent = val;
            debouncedGenerateImages(); saveSnapshot();
        }
    });

    // 색상 프리셋
    renderColorPresets();
    renderMiniColorPresets('numColorPresets');
    renderMiniColorPresets('textColorPresets');
    initMiniPresetHandlers();
    document.getElementById('colorPresets')?.addEventListener('click', e => {
        // 빌트인 프리셋 카드
        const card = e.target.closest('.preset-card');
        if (card?.dataset.color) {
            saveSnapshot(); updateColorSync(card.dataset.color);
            debouncedGenerateImages(); return;
        }
        if (e.target.classList.contains('swatch-delete')) {
            const idx = parseInt(e.target.dataset.delete);
            const slots = loadColorSlots(); slots.splice(idx, 1);
            saveColorSlots(slots); renderColorPresets(); return;
        }
        if (e.target.id === 'presetAddBtn' || e.target.closest('#presetAddBtn')) {
            const color = document.getElementById('themeHex')?.value || '#000000';
            const slots = loadColorSlots();
            if (slots.length >= 6) return showColorToast('최대 6개까지 저장 가능합니다');
            if (!slots.includes(color.toUpperCase())) {
                slots.push(color.toUpperCase()); saveColorSlots(slots);
                renderColorPresets(); showColorToast('색상이 저장되었습니다');
            } else showColorToast('이미 저장된 색상입니다');
            return;
        }
        const swatch = e.target.closest('.preset-swatch');
        if (swatch?.dataset.color) {
            saveSnapshot(); updateColorSync(swatch.dataset.color);
            debouncedGenerateImages();
        }
    });

    // 리모컨 버튼
    document.getElementById('remoteUndo').addEventListener('click', undo);
    document.getElementById('remoteRedo').addEventListener('click', redo);
    document.getElementById('remoteDownload').addEventListener('click', downloadImages);
    document.getElementById('remoteSaveBtn').addEventListener('click', saveProject);
    document.getElementById('remoteLoadBtn').addEventListener('click', () => document.getElementById('loadFileInput').click());
    document.getElementById('loadFileInput').addEventListener('change', loadProject);
    document.getElementById('remoteGoTop').addEventListener('click', () => {
        document.querySelector('.items-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('remoteGoBottom').addEventListener('click', () => {
        const el = document.querySelector('.items-scroll');
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });

    // 단축키
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveProject(); }
    });

    // CSS 변수 --h1-bar-color 를 실제 초기 테마색과 일치시킴 (style.css 기본값과 다를 수 있음)
    updateColorSync(document.getElementById('themeHex').value || '#000000');

    // 세션 복원 or 초기 상태
    const restored = restoreFromSessionStorage();
    if (!restored) {
        // 기본 샘플 로드
        addSectionTitle('쁘띠 이벤트');
        addItemRow({ itemName: '아쿠아필(블랙헤드)', p1Label: '5회', p1: '20만원', p2Label: '10회', p2: '30만원' });
        addItemRow({ itemName: '리프팅 1회', p1: '40만원' });
        addSectionTitle('보톡스 이벤트');
        addItemRow({ itemName: '이마·미간·눈가', p1Label: '1회', p1: '4만원', p2Label: '3회', p2: '9만원' });
        addItemRow({ itemName: '사각턱', p1Label: '1회', p1: '6만원', p2Label: '3회', p2: '15만원' });
        addColumnBreak();
        addSectionTitle('토닝 이벤트');
        addItemRow({ itemName: '듀얼토닝', p1Label: '5회', p1: '25만원', p2Label: '10회', p2: '35만원', note: '※ 관리 추가 시 10회 10만원' });
        addSectionTitle('리프팅 이벤트');
        addItemRow({ itemName: '하안검 실리프팅', p1: '40만원' });
        addItemRow({ itemName: '얼굴전체 탄력리프팅', p1Label: '1회', p1: '50만원', p2Label: '3회', p2: '120만원' });
        saveSnapshot();
        generateImages();
    }
    initBookmarkObserver();
    refreshBookmarks();

    // ── 컬럼 삽입 호버 버튼 ──
    const colInsertBtn = document.createElement('button');
    colInsertBtn.id = 'colInsertBtn';
    colInsertBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/></svg> 여기서 컬럼 분리`;
    document.body.appendChild(colInsertBtn);

    function canInsertColBreakBefore(el) {
        let prev = el.previousElementSibling;
        while (prev && prev.classList.contains('items-empty-hint')) prev = prev.previousElementSibling;
        if (!prev) return false;
        if (prev.classList.contains('column-break-wrapper')) return false;
        return true;
    }

    let _colBtnTarget = null;
    let _colBtnHideTimer = null;
    let _colBtnHoveredSection = null;

    function showColInsertBtn(section) {
        clearTimeout(_colBtnHideTimer);
        const rect = section.getBoundingClientRect();
        const moveMode = Array.from(document.getElementById('itemsContainer').children)
            .some(n => n.classList.contains('column-break-wrapper'));
        if (moveMode) {
            colInsertBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/></svg> 여기로 컬럼 이동`;
            colInsertBtn.classList.add('move-mode');
        } else {
            colInsertBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/></svg> 여기서 컬럼 분리`;
            colInsertBtn.classList.remove('move-mode');
        }
        colInsertBtn.style.top = Math.max(8, rect.top - 14) + 'px';
        colInsertBtn.style.left = (rect.left + rect.width / 2) + 'px';
        colInsertBtn.classList.add('visible');
        _colBtnTarget = section;
    }

    function hideColInsertBtn() {
        colInsertBtn.classList.remove('visible');
        _colBtnTarget = null;
        _colBtnHoveredSection = null;
    }

    container.addEventListener('mouseover', e => {
        const section = e.target.closest('.section-title-wrapper');
        if (section === _colBtnHoveredSection) return;
        _colBtnHoveredSection = section;
        clearTimeout(_colBtnHideTimer);
        if (!section || !canInsertColBreakBefore(section)) {
            _colBtnHideTimer = setTimeout(hideColInsertBtn, 150);
            return;
        }
        showColInsertBtn(section);
    });

    container.addEventListener('mouseleave', () => {
        _colBtnHoveredSection = null;
        _colBtnHideTimer = setTimeout(hideColInsertBtn, 150);
    });

    document.querySelector('.items-scroll')?.addEventListener('scroll', hideColInsertBtn);

    colInsertBtn.addEventListener('mouseenter', () => clearTimeout(_colBtnHideTimer));
    colInsertBtn.addEventListener('mouseleave', () => {
        _colBtnHideTimer = setTimeout(hideColInsertBtn, 150);
    });
    colInsertBtn.addEventListener('click', () => {
        if (!_colBtnTarget) return;
        saveSnapshot();
        const c = document.getElementById('itemsContainer');
        // 기존 컬럼 구분이 있으면 먼저 제거 (이동 모드)
        const existingBreak = c.querySelector('.column-break-wrapper');
        if (existingBreak) existingBreak.remove();
        addColumnBreak();
        c.insertBefore(c.lastElementChild, _colBtnTarget);
        hideColInsertBtn();
    });
};
