/* ============================================================
 * 전역 상태 및 상수
 * ============================================================ */
let generatedImagesUrls = [];
let cachedBgImg = null;
let isBackedUp = true;

/* ============================================================
 * 의료법 위반 대응 사전 (BANNED_WORDS)
 * ============================================================ */
const BANNED_WORDS = {
    '신데렐라주사': '티옥트산주사',
    '신데렐라': '티옥트산주사',
    '백옥주사': '글루타치온주사',
    '마늘주사': '알리마주사',
    '아기주사': '성장인자주사',
    '연어주사': 'PDRN주사',
    '감초주사': '히시파겐씨주사',
    '샤넬주사': '필로르가주사',
    '줄기세포': '피부재생관리',
    '엑소좀': '피부재생관리',
    '에토좀': '피부재생관리',
    'ASCE': '피부재생관리',
    'TA': '염증주사',
    '1+1': '1회 가격에 2회 시술',
    '2+1': '2회 가격에 3회 시술',
    '5+5': '5회 가격에 10회 시술',
    '5+1': '5회 가격에 6회 시술',
    '6+6': '6회 가격에 12회 시술',
    '10+10': '10회 가격에 20회 시술',
    '프리미엄': '시그니처',
    '통증없는': '통증줄인',
    '내성없는': '내성줄인',
    '다이어트': '비만치료',
    's/v': '혜택',
    '서비스': '혜택',
    '증정': '포함',
    '무제한': null,
    '연예인': null,
    '이영애': null,
    '선착순': null,
    '기간제한 없음': null,
    '실비': null,
    '즉각효과': null,
    '명품': null,
    '무너지지 않는': null,
    'Free': null,
    '최초': null,
    '100%': null,
    '부작용 제로': null,
    '영구적': null,
    '완치': null,
    '최고': null,
    '유일': null,
    '특허': null,
    '국내 유일': null,
    '부작용 없음': null,
    '전무': null,
    '완전 제거': null,
    '즉시 해결': null,
    '세계 1위': null,
    '부작용 걱정 없는': null,
    '확실한 보장': null,
    '최적': null,
    '완벽': null,
    '첨단': null,
    '획기적': null,
    '비교불가': null
};
const EXCEPTION_WORDS = ['태반주사', '엑토좀PTT'];
const MAX_UNDO = 100;

let undoHistory = [];
let redoHistory = [];
let lastSelectedItem = null;

const SS_KEY = 'eventData';
const SS_BOOKMARK_KEY = 'bookmarkState';
const SS_BG_KEY = 'bgImage';

/* ============================================================
 * 유틸리티 함수
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
    const sanitized = id.replace(/[^a-zA-Z0-9\-]/g, '');
    return sanitized || null;
}

/* ============================================================
 * 의료법 위반 실시간 감지 로직
 * ============================================================ */
function checkMedicalLaw(text) {
    if (!text) return [];
    const violations = [];
    const lowerText = text.toLowerCase();

    // 소문자 기준으로 중복 제거 (ASCE/asce 같은 경우 한 번만 처리)
    const seenLower = new Set();
    const bannedEntries = [];
    Object.entries(BANNED_WORDS).forEach(([word, replacement]) => {
        const lower = word.toLowerCase();
        if (!seenLower.has(lower)) {
            seenLower.add(lower);
            bannedEntries.push({ word, lower, replacement });
        }
    });

    bannedEntries.forEach(({ word, lower, replacement }) => {
        let searchFrom = 0;
        let foundAt;
        let hasNonExceptionOccurrence = false;

        while ((foundAt = lowerText.indexOf(lower, searchFrom)) !== -1) {
            let isException = false;
            EXCEPTION_WORDS.forEach(ex => {
                const lowerEx = ex.toLowerCase();
                const escaped = lowerEx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const exRegex = new RegExp(escaped, 'g');
                let match;
                while ((match = exRegex.exec(lowerText)) !== null) {
                    if (foundAt >= match.index && foundAt < match.index + ex.length) {
                        isException = true;
                    }
                }
            });

            if (!isException) {
                hasNonExceptionOccurrence = true;
                break;
            }
            searchFrom = foundAt + 1;
        }

        if (hasNonExceptionOccurrence) {
            violations.push({ word, replacement });
        }
    });
    return violations;
}

function updateViolationUI(el) {
    const text = el.value;
    const violations = checkMedicalLaw(text);
    const parent = el.closest('.item-row, .section-title-wrapper, .form-section') || el.parentElement;

    const currentViolationWord = violations.length > 0 ? violations[0].word : '';

    if (violations.length === 0) {
        el.classList.remove('violation-input');
        el.removeAttribute('data-last-violation');
        const oldTooltip = parent.querySelector('.violation-tooltip');
        if (oldTooltip) oldTooltip.remove();
        parent.classList.remove('has-active-tooltip');
        return;
    }

    if (el.getAttribute('data-last-violation') === currentViolationWord && parent.querySelector('.violation-tooltip')) {
        return;
    }

    const oldTooltip = parent.querySelector('.violation-tooltip');
    if (oldTooltip) oldTooltip.remove();
    parent.classList.add('has-active-tooltip');

    el.classList.add('violation-input');
    el.setAttribute('data-last-violation', currentViolationWord);

    const violation = violations[0];
    const tooltip = document.createElement('div');
    tooltip.className = 'violation-tooltip';
    tooltip.innerHTML = `<span>⚠️ 의료법 위반 소지 단어: '${escapeHtml(violation.word)}'</span>`;
    if (violation.replacement) {
        const btn = document.createElement('button');
        btn.className = 'fix-btn';
        btn.innerHTML = `✨ '${escapeHtml(violation.replacement)}'로 수정하기`;
        btn.onmousedown = (e) => e.preventDefault();
        btn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const escaped = violation.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            el.value = el.value.replace(new RegExp(escaped, 'gi'), violation.replacement);
            el.removeAttribute('data-last-violation');
            updateViolationUI(el);
            saveSnapshot();
            debouncedGenerateImages();
        };
        tooltip.appendChild(btn);
    }

    const startHideTimer = () => {
        clearTimeout(el._tooltipHideTimer);
        el._tooltipHideTimer = setTimeout(() => {
            tooltip.remove();
            parent.classList.remove('has-active-tooltip');
            el.removeAttribute('data-last-violation');
        }, 200);
    };

    tooltip.addEventListener('mouseenter', () => clearTimeout(el._tooltipHideTimer));
    tooltip.addEventListener('mouseleave', startHideTimer);

    if (el._violationMouseLeave) el.removeEventListener('mouseleave', el._violationMouseLeave);
    if (el._violationMouseEnter) el.removeEventListener('mouseenter', el._violationMouseEnter);
    if (el._violationBlur) el.removeEventListener('blur', el._violationBlur);
    el._violationMouseLeave = startHideTimer;
    el._violationMouseEnter = () => clearTimeout(el._tooltipHideTimer);
    el._violationBlur = startHideTimer;
    el.addEventListener('mouseleave', el._violationMouseLeave);
    el.addEventListener('mouseenter', el._violationMouseEnter);
    el.addEventListener('blur', el._violationBlur);

    parent.appendChild(tooltip);

    const parentRect = parent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    tooltip.style.top = (elRect.bottom - parentRect.top + 6) + 'px';
    tooltip.style.left = (elRect.left - parentRect.left + (el.classList.contains('item-name') ? 10 : 0)) + 'px';
}

function getSnapshot() {
    const items = [];
    const container = document.getElementById('itemsContainer');
    Array.from(container.children).forEach(child => {
        const undoId = child.getAttribute('data-undo-id') || generateUniqueId(child.classList.contains('item-row') ? 'item' : 'sec');
        if (child.classList.contains('item-row')) {
            items.push({
                type: 'item', id: undoId,
                itemName: child.querySelector('.item-name').value,
                unit: child.querySelector('.item-unit').value,
                price: child.querySelector('.item-price').value
            });
        } else if (child.classList.contains('section-title-wrapper')) {
            items.push({
                type: 'sectionTitle', id: undoId,
                value: child.querySelector('.section-title-input').value,
                size: child.querySelector('.section-title-size').value,
                bodySize: child.querySelector('.section-body-size') ? child.querySelector('.section-body-size').value : "25",
                layout: child.querySelector('.section-title-layout').value,
                collapsed: child.classList.contains('collapsed')
            });
        } else if (child.classList.contains('page-break-wrapper')) {
            items.push({ type: 'pageBreak', id: undoId });
        }
    });

    const activeEl = document.activeElement;
    let focusInfo = null;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        const identifiableParent = activeEl.closest('[data-undo-id]');
        focusInfo = {
            parentId: identifiableParent ? identifiableParent.getAttribute('data-undo-id') : activeEl.id,
            className: activeEl.className.split(' ').find(c => c !== 'btn-input'),
            selectionStart: activeEl.selectionStart,
            selectionEnd: activeEl.selectionEnd
        };
    }

    const checkedBookmarks = Array.from(document.querySelectorAll('.bookmark-check:checked')).map(cb => cb.getAttribute('data-target-id'));
    const selectedIds = Array.from(document.querySelectorAll('#itemsContainer .item-selected')).map(el => el.getAttribute('data-undo-id'));

    return {
        topTitle: document.getElementById('topTitle').value,
        topDate: document.getElementById('topDate').value,
        botText: document.getElementById('botText').value,
        themeColor: document.getElementById('themeHex').value,
        canvasWidth: CONFIG.width,
        canvasHeight: CONFIG.height,
        items: items,
        focusInfo: focusInfo,
        checkedBookmarks: checkedBookmarks,
        selectedIds: selectedIds
    };
}

function saveSnapshot() {
    const snapshot = getSnapshot();
    const snapshotStr = JSON.stringify(snapshot);
    if (undoHistory.length > 0 && undoHistory[undoHistory.length - 1] === snapshotStr) return;

    undoHistory.push(snapshotStr);
    if (undoHistory.length > MAX_UNDO) undoHistory.shift();
    redoHistory = [];
    updateRemoteState();
    saveToSessionStorage(snapshot);
}

let typingTimer = null;
function handleInputSnapshot() {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => saveSnapshot(), 400);
}

function updateRemoteState() {
    const undoBtn = document.getElementById('remoteUndo');
    const redoBtn = document.getElementById('remoteRedo');
    if (undoBtn) undoBtn.disabled = undoHistory.length === 0;
    if (redoBtn) redoBtn.disabled = redoHistory.length === 0;
}

function restoreSnapshot(data) {
    if (typeof data === 'string') data = JSON.parse(data);
    if (!data) return;

    if (data.hasOwnProperty('topTitle')) document.getElementById('topTitle').value = data.topTitle;
    if (data.hasOwnProperty('topDate')) document.getElementById('topDate').value = data.topDate;
    if (data.hasOwnProperty('botText')) document.getElementById('botText').value = data.botText;
    if (data.themeColor) updateColorSync('theme', data.themeColor);
    if (data.canvasWidth && data.canvasHeight) {
        CONFIG.width = data.canvasWidth;
        CONFIG.height = data.canvasHeight;
        document.querySelectorAll('.ratio-btn').forEach(btn => {
            btn.classList.toggle('active',
                Number(btn.dataset.w) === data.canvasWidth && Number(btn.dataset.h) === data.canvasHeight
            );
        });
    }

    let itemsData = Array.isArray(data) ? data : (data.items || []);
    const container = document.getElementById('itemsContainer');
    container.innerHTML = '';
    itemsData.forEach(item => {
        switch (item.type) {
            case 'item': addItemRow(item.itemName, item.unit, item.price, item.id); break;
            case 'sectionTitle': addSectionTitle(item.value, item.size, item.layout, item.collapsed, item.id, item.bodySize); break;
            case 'pageBreak': addPageBreak(null, item.id); break;
        }
    });

    ['topTitle', 'topDate', 'botText'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            autoResizeTextarea(el);
            updateViolationUI(el);
        }
    });

    document.querySelectorAll('.item-name').forEach(el => updateViolationUI(el));
    refreshAccordionVisibility();

    if (data.selectedIds && Array.isArray(data.selectedIds)) {
        data.selectedIds.forEach(id => {
            const el = document.querySelector(`[data-undo-id="${id}"]`);
            if (el) el.classList.add('item-selected');
        });
    }

    if (data.checkedBookmarks && Array.isArray(data.checkedBookmarks)) {
        data.checkedBookmarks.forEach(id => {
            const cb = document.querySelector(`.bookmark-check[data-target-id="${id}"]`);
            if (cb) cb.checked = true;
        });
        updateBookmarkSidebar();
    }

    updateRemoteState();
    if (data.focusInfo) {
        const focusInfo = data.focusInfo;
        setTimeout(() => {
            let target = null;
            if (focusInfo.parentId) {
                const parent = document.querySelector(`[data-undo-id="${focusInfo.parentId}"]`) || document.getElementById(focusInfo.parentId);
                if (parent) {
                    if (parent.tagName === 'INPUT' || parent.tagName === 'TEXTAREA') target = parent;
                    else if (focusInfo.className) target = parent.querySelector(`.${focusInfo.className}`);
                }
            }
            if (target) {
                target.focus();
                if (target.setSelectionRange) target.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionEnd);
            }
        }, 0);
    }
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
    if (isBackedUp) {
        isBackedUp = false;
        const btn = document.getElementById('saveProjectBtn');
        if (btn) { btn.classList.add('btn-unsaved'); btn.title = '백업되지 않은 변경 사항이 있습니다'; }
        const remoteBtn = document.getElementById('remoteSaveBtn');
        if (remoteBtn) { remoteBtn.classList.add('rbtn-unsaved'); remoteBtn.title = '백업되지 않은 변경 사항이 있습니다'; }
    }
}

function markSaved() {
    isBackedUp = true;
    const btn = document.getElementById('saveProjectBtn');
    if (btn) { btn.classList.remove('btn-unsaved'); btn.title = ''; }
    const remoteBtn = document.getElementById('remoteSaveBtn');
    if (remoteBtn) { remoteBtn.classList.remove('rbtn-unsaved'); remoteBtn.title = '파일 백업 (저장)'; }
}

const DRAG_HANDLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
const CLOSE_SVG_16 = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const CLOSE_SVG_14 = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const COPY_SVG_16 = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const COPY_SVG_14 = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const OPTS_SVG_14 = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;

function validateItems(items) {
    if (!Array.isArray(items)) return [];
    const MAX_LEN = 500;
    const VALID_SIZES = ['39', '49', '59'];
    const VALID_BODY_SIZES = ['21', '23', '25', '27', '29'];
    const VALID_LAYOUTS = ['horizontal', 'vertical'];
    return items
        .filter(item => item && typeof item === 'object' && ['item', 'sectionTitle', 'pageBreak'].includes(item.type))
        .map(item => {
            if (item.type === 'item') return {
                type: 'item',
                id: sanitizeId(item.id) || generateUniqueId('item'),
                itemName: typeof item.itemName === 'string' ? item.itemName.slice(0, MAX_LEN) : '',
                unit: typeof item.unit === 'string' ? item.unit.slice(0, MAX_LEN) : '',
                price: typeof item.price === 'string' ? item.price.slice(0, MAX_LEN) : ''
            };
            if (item.type === 'sectionTitle') return {
                type: 'sectionTitle',
                id: sanitizeId(item.id) || generateUniqueId('sec'),
                value: typeof item.value === 'string' ? item.value.slice(0, MAX_LEN) : '',
                size: VALID_SIZES.includes(String(item.size)) ? String(item.size) : '49',
                bodySize: VALID_BODY_SIZES.includes(String(item.bodySize)) ? String(item.bodySize) : '25',
                layout: VALID_LAYOUTS.includes(item.layout) ? item.layout : 'horizontal',
                collapsed: !!item.collapsed
            };
            return { type: 'pageBreak', id: sanitizeId(item.id) || generateUniqueId('pb') };
        });
}

function saveProject() {
    const data = getSnapshot();
    const topTitle = document.getElementById('topTitle').value.replace(/[\\/:*?"<>|]/g, "_") || "이벤트";
    const now = new Date();
    const dateStr = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0');
    const timeStr = now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0') + now.getSeconds().toString().padStart(2, '0');
    const blob = new Blob([JSON.stringify(data)], { type: "application/json;charset=utf-8" });
    saveAs(blob, `${topTitle}_백업_${dateStr}_${timeStr}.json`);
    markSaved();
}

function loadProject(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            const MAX_FIELD_LEN = 200;
            if (data.hasOwnProperty('topTitle') && typeof data.topTitle === 'string') document.getElementById('topTitle').value = data.topTitle.slice(0, MAX_FIELD_LEN);
            if (data.hasOwnProperty('topDate') && typeof data.topDate === 'string') document.getElementById('topDate').value = data.topDate.slice(0, MAX_FIELD_LEN);
            if (data.hasOwnProperty('botText') && typeof data.botText === 'string') document.getElementById('botText').value = data.botText.slice(0, MAX_FIELD_LEN);
            if (data.themeColor && typeof data.themeColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(data.themeColor)) updateColorSync('theme', data.themeColor);

            const VALID_RATIOS = new Set(['1000x1000', '1000x1250', '1000x1778']);
            if (Number.isInteger(data.canvasWidth) && Number.isInteger(data.canvasHeight) &&
                VALID_RATIOS.has(`${data.canvasWidth}x${data.canvasHeight}`)) {
                CONFIG.width = data.canvasWidth;
                CONFIG.height = data.canvasHeight;
                document.querySelectorAll('.ratio-btn').forEach(btn => {
                    btn.classList.toggle('active',
                        Number(btn.dataset.w) === data.canvasWidth && Number(btn.dataset.h) === data.canvasHeight
                    );
                });
            }
            if (data.items) restoreSnapshot(validateItems(data.items));
            else if (Array.isArray(data)) restoreSnapshot(validateItems(data));
            if (data.bgImage) {
                const img = new Image();
                img.src = data.bgImage;
                img.onload = () => {
                    cachedBgImg = img;
                    setFileLabelAttached("백업에서 불러온 배경 이미지");
                    document.getElementById('dropZone').classList.add('file-attached');
                    showBgThumb(data.bgImage);
                };
            } else {
                if (!cachedBgImg) alert('내용을 불러왔습니다.\n배경 이미지는 백업에 포함되지 않습니다. 배경 이미지를 다시 선택해 주세요.');
            }

            setTimeout(() => {
                ['topTitle', 'topDate', 'botText'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) autoResizeTextarea(el);
                });
                refreshAccordionVisibility();
                debouncedGenerateImages();
                markSaved();
            }, 50);
        } catch (err) { alert('잘못된 백업 파일입니다.'); }
    };
    reader.readAsText(file);
    event.target.value = '';
}

/* ============================================================
 * 자동 임시 저장 (sessionStorage)
 * ============================================================ */
function saveToSessionStorage(data = null) {
    try {
        const snapshot = data || getSnapshot();
        const eventData = {
            topTitle: snapshot.topTitle,
            topDate: snapshot.topDate,
            botText: snapshot.botText,
            themeColor: snapshot.themeColor,
            canvasWidth: snapshot.canvasWidth,
            canvasHeight: snapshot.canvasHeight,
            items: snapshot.items,
            focusInfo: snapshot.focusInfo,
            selectedIds: snapshot.selectedIds
        };
        sessionStorage.setItem(SS_KEY, JSON.stringify(eventData));
        sessionStorage.setItem(SS_BOOKMARK_KEY, JSON.stringify(snapshot.checkedBookmarks || []));

        if (cachedBgImg?.src?.startsWith('data:')) {
            try { sessionStorage.setItem(SS_BG_KEY, cachedBgImg.src); } catch (e) { console.warn('배경 이미지 저장 용량 초과'); }
        }
    } catch (e) { console.warn('sessionStorage 저장 실패:', e.message); }
}

function restoreFromSessionStorage() {
    try {
        const savedData = sessionStorage.getItem(SS_KEY);
        if (!savedData) return false;

        const data = JSON.parse(savedData);
        const bookmarkData = JSON.parse(sessionStorage.getItem(SS_BOOKMARK_KEY) || '[]');
        data.checkedBookmarks = bookmarkData;
        data.items = validateItems(data.items || []);
        restoreSnapshot(data);

        const bgData = sessionStorage.getItem(SS_BG_KEY);
        if (bgData) {
            const img = new Image();
            img.src = bgData;
            img.onload = () => {
                cachedBgImg = img;
                setFileLabelAttached('임시 저장에서 복원된 배경 이미지');
                document.getElementById('dropZone').classList.add('file-attached');
                showBgThumb(bgData);
                generateImages();
            };
        }
        return true;
    } catch (e) { return false; }
}

let isAllCollapsed = false;
function toggleAllAccordions() {
    isAllCollapsed = !isAllCollapsed;
    const container = document.getElementById('itemsContainer');
    const btn = document.querySelector('.btn-toggle');
    isAllCollapsed ? btn.classList.remove('active') : btn.classList.add('active');
    Array.from(container.children).forEach(node => {
        if (node.classList.contains('section-title-wrapper')) {
            isAllCollapsed ? node.classList.add('collapsed') : node.classList.remove('collapsed');
            node.setAttribute('aria-expanded', isAllCollapsed ? 'false' : 'true');
        }
    });
    refreshAccordionVisibility();
    saveSnapshot();
}

function addSectionTitle(titleValue = "", titleSize = "49", layout = "horizontal", isCollapsed = false, undoId = null, bodySize = "25") {
    const container = document.getElementById('itemsContainer');
    const wrapper = document.createElement('div');
    wrapper.className = 'section-title-wrapper';
    wrapper.setAttribute('data-undo-id', sanitizeId(undoId) || generateUniqueId('sec'));
    wrapper.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    if (isCollapsed) wrapper.classList.add('collapsed');
    wrapper.innerHTML = `
        <div class="event-badge-wrapper"><div class="event-badge">이벤트</div><span class="section-count-badge"></span><div class="section-accordion-arrow"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></div></div>
        <div class="section-main-row">
            <div class="handle-column"><div class="drag-handle">${DRAG_HANDLE_SVG}</div></div>
            <div class="section-title-field">
                <div class="section-title-label-row">
                    <span style="font-size: 11px; font-weight: 800; color: var(--primary);">제목</span>
                </div>
                <div class="item-name-wrapper">
                    <textarea class="btn-input section-title-input auto-resize" placeholder="중앙 배너 제목 입력 (예: 보톡스 이벤트)">${escapeHtml(titleValue)}</textarea>
                    <div class="format-toolbar">
                        <button class="fmt-btn" data-open="&lt;" data-close="&gt;" title="강조색 적용">&lt;강조&gt;</button>
                        <button class="fmt-btn" data-open="&lt;+" data-close="+&gt;" title="글자 확대">&lt;+확대+&gt;</button>
                        <button class="fmt-btn" data-open="&lt;-" data-close="-&gt;" title="글자 축소">&lt;-축소-&gt;</button>
                        <button class="fmt-btn" data-open="{" data-close="}" title="굵게">{굵게}</button>
                    </div>
                </div>
            </div>
            <div class="row-actions" style="display:flex; flex-direction:row; gap:4px; align-self: flex-end; margin-bottom: 2px; justify-content: flex-end;">
                <button class="btn-copy btn-opts-settings js-toggle-section-opts" title="크기 및 정렬 설정">${OPTS_SVG_14}</button>
                <button class="btn-copy js-dup-section" title="섹션 및 하위 항목 복제">${COPY_SVG_16}</button>
                <button class="btn-remove js-del-section" title="섹션 및 하위 항목 전체 삭제">${CLOSE_SVG_16}</button>
            </div>
        </div>
        <div class="section-options-row">
            <div style="display:flex; flex-direction:column; gap:4px;">
                <span style="font-size: 11px; font-weight: 800; color: var(--primary);">제목 크기</span>
                <select class="btn-input section-title-size">
                    <option value="39" ${titleSize === '39' ? 'selected' : ''}>작게</option>
                    <option value="49" ${titleSize === '49' ? 'selected' : ''}>보통</option>
                    <option value="59" ${titleSize === '59' ? 'selected' : ''}>크게</option>
                </select>
            </div>
            <div style="display:flex; flex-direction:column; gap:4px;">
                <span style="font-size: 11px; font-weight: 800; color: var(--primary);">본문 크기</span>
                <select class="btn-input section-body-size">
                    <option value="21" ${bodySize === '21' ? 'selected' : ''}>조그맣게</option>
                    <option value="23" ${bodySize === '23' ? 'selected' : ''}>작게</option>
                    <option value="25" ${bodySize === '25' ? 'selected' : ''}>보통</option>
                    <option value="27" ${bodySize === '27' ? 'selected' : ''}>크게</option>
                    <option value="29" ${bodySize === '29' ? 'selected' : ''}>큼직하게</option>
                </select>
            </div>
            <div style="display:flex; flex-direction:column; gap:4px;">
                <span style="font-size: 11px; font-weight: 800; color: var(--primary);">정렬</span>
                <select class="btn-input section-title-layout">
                    <option value="horizontal" ${layout === 'horizontal' ? 'selected' : ''}>가로 정렬</option>
                    <option value="vertical" ${layout === 'vertical' ? 'selected' : ''}>세로 정렬</option>
                </select>
            </div>
        </div>
    `;

    container.appendChild(wrapper);
    initDragAndDrop(wrapper);

    wrapper.addEventListener('click', function (e) {
        if (window.getSelection().toString().length > 0) return;
        if (e.target.closest('input, textarea, select, button, .drag-handle')) return;
        activateSection(this, true, false);
    });

    setTimeout(() => autoResizeTextarea(wrapper.querySelector('.section-title-input')), 0);
    refreshAccordionVisibility();
    debouncedGenerateImages();
}

function activateSection(targetNode, preventWindowScroll = false, autoCollapseOthers = true) {
    const isAlreadyOpen = !targetNode.classList.contains('collapsed');
    const container = document.getElementById('itemsContainer');

    if (isAlreadyOpen) {
        targetNode.classList.add('collapsed');
        targetNode.setAttribute('aria-expanded', 'false');
    } else {
        if (autoCollapseOthers) {
            Array.from(container.children).forEach(child => {
                if (child.classList.contains('section-title-wrapper')) {
                    const open = child === targetNode;
                    open ? child.classList.remove('collapsed') : child.classList.add('collapsed');
                    child.setAttribute('aria-expanded', open ? 'true' : 'false');
                }
            });
        } else {
            targetNode.classList.remove('collapsed');
            targetNode.setAttribute('aria-expanded', 'true');
        }
    }
    refreshAccordionVisibility();
    if (!preventWindowScroll) {
        const y = targetNode.getBoundingClientRect().top + window.scrollY - 20;
        window.scrollTo({ top: y, behavior: 'smooth' });
    }

    if (!targetNode.classList.contains('collapsed')) {
        const pIdx = targetNode.getAttribute('data-page-index');
        if (pIdx !== null) {
            const previewContainer = document.getElementById('previewContainer');
            const targetImg = previewContainer?.querySelectorAll('img')[parseInt(pIdx)];
            if (targetImg && previewContainer) {
                const containerRect = previewContainer.getBoundingClientRect();
                const imgRect = targetImg.getBoundingClientRect();
                const offset = imgRect.top - containerRect.top - 20;
                if (Math.abs(offset) > 5) previewContainer.scrollBy({ top: offset, behavior: 'smooth' });
            }
        }
        const sidebar = document.getElementById('bookmarkSidebar');
        const undoId = targetNode.getAttribute('data-undo-id');
        if (sidebar && undoId) {
            const activeBookmark = sidebar.querySelector(`.bookmark-check[data-target-id="${undoId}"]`)?.closest('.bookmark-btn');
            if (activeBookmark) {
                const scrollArea = sidebar.querySelector('.bookmark-scroll-area');
                if (scrollArea) {
                    const btnTop = activeBookmark.offsetTop;
                    const btnBottom = btnTop + activeBookmark.offsetHeight;
                    const areaHeight = scrollArea.clientHeight;
                    const cur = scrollArea.scrollTop;
                    if (btnTop < cur) scrollArea.scrollTop = btnTop - 4;
                    else if (btnBottom > cur + areaHeight) scrollArea.scrollTop = btnBottom - areaHeight + 4;
                }
            }
        }
    }
}

function updateBookmarkSidebar() {
    const sidebar = document.getElementById('bookmarkSidebar');
    if (!sidebar) return;

    const container = document.getElementById('itemsContainer');
    const nodes = Array.from(container.children).filter(n => n.classList.contains('section-title-wrapper'));
    const checkedIds = new Set();
    sidebar.querySelectorAll('.bookmark-check:checked').forEach(cb => checkedIds.add(cb.getAttribute('data-target-id')));

    const existingBtns = sidebar.querySelectorAll('.bookmark-btn');

    if (existingBtns.length === nodes.length) {
        nodes.forEach((node, index) => {
            const rawTitle = node.querySelector('.section-title-input')?.value.trim() || "";
            const displayTitle = rawTitle || `이벤트 ${index + 1}`;
            const undoId = node.getAttribute('data-undo-id');
            const btn = existingBtns[index];

            !node.classList.contains('collapsed') ? btn.classList.add('active') : btn.classList.remove('active');

            const textSpan = btn.querySelector('.bookmark-text');
            if (textSpan && textSpan.textContent !== displayTitle) textSpan.textContent = displayTitle;
            btn.title = displayTitle;

            const checkbox = btn.querySelector('.bookmark-check');
            if (checkbox && checkbox.getAttribute('data-target-id') !== undoId) checkbox.setAttribute('data-target-id', escapeHtml(undoId));
            if (checkbox) checkbox.checked = checkedIds.has(undoId);

            btn.onclick = () => activateSection(node, false, true);
        });
        return;
    }

    sidebar.innerHTML = '';
    if (nodes.length > 0) {
        const header = document.createElement('div');
        header.className = 'bookmark-sidebar-header';
        header.textContent = '체크 → 선택 다운로드';
        sidebar.appendChild(header);
    }
    const scrollArea = document.createElement('div');
    scrollArea.className = 'bookmark-scroll-area';
    nodes.forEach((node, index) => {
        const rawTitle = node.querySelector('.section-title-input')?.value.trim() || "";
        const displayTitle = rawTitle || `이벤트 ${index + 1}`;
        const undoId = node.getAttribute('data-undo-id');

        const btn = document.createElement('div');
        btn.className = 'bookmark-btn';
        if (!node.classList.contains('collapsed')) btn.classList.add('active');

        btn.innerHTML = `
            <label class="custom-check-container">
                <input type="checkbox" class="bookmark-check" data-target-id="${escapeHtml(undoId)}" ${checkedIds.has(undoId) ? 'checked' : ''}>
                <span class="checkmark"></span>
            </label>
            <span class="bookmark-text">${escapeHtml(displayTitle)}</span>
        `;
        btn.querySelector('.custom-check-container').addEventListener('click', (e) => e.stopPropagation());
        btn.title = displayTitle;
        btn.onclick = () => activateSection(node, false, true);
        scrollArea.appendChild(btn);
    });
    sidebar.appendChild(scrollArea);
}

function downloadSelectedImages() {
    if (generatedImagesUrls.length === 0) return alert('먼저 이미지를 생성해주세요.');
    const checkedBoxes = Array.from(document.getElementById('bookmarkSidebar').querySelectorAll('.bookmark-check[data-target-id]:checked'));
    if (checkedBoxes.length === 0) return alert('다운로드할 북마크를 체크해주세요.');

    const selectedIndices = new Set();
    checkedBoxes.forEach(cb => {
        const targetNode = document.querySelector(`[data-undo-id="${cb.getAttribute('data-target-id')}"]`);
        if (targetNode) {
            const pIdx = targetNode.getAttribute('data-page-index');
            if (pIdx !== null) selectedIndices.add(parseInt(pIdx));
        }
    });
    const indices = Array.from(selectedIndices).sort((a, b) => a - b);
    if (indices.length === 0) return alert('선택한 항목에 대한 생성된 이미지가 없습니다.');
    const topTitle = document.getElementById('topTitle').value.replace(/[\\/:*?"<>|]/g, "_") || "이벤트";
    const now = new Date();
    const dateStr = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0');

    if (indices.length === 1) {
        const link = document.createElement('a');
        link.download = `${topTitle}_${dateStr}_${(indices[0] + 1).toString().padStart(2, '0')}.jpg`;
        link.href = generatedImagesUrls[indices[0]];
        document.body.appendChild(link);
        link.click();
        link.remove();
    } else {
        const zip = new JSZip();
        indices.forEach(imgIdx => {
            const dataUrl = generatedImagesUrls[imgIdx];
            if (dataUrl) zip.file((imgIdx + 1).toString().padStart(2, '0') + ".jpg", dataUrl.replace(/^data:image\/(png|jpeg);base64,/, ""), { base64: true });
        });
        zip.generateAsync({ type: "blob" }).then(content => saveAs(content, `${topTitle}_선택항목_${dateStr}.zip`));
    }
}

function refreshAccordionVisibility() {
    const container = document.getElementById('itemsContainer');
    let currentCollapsed = false;

    Array.from(container.children).forEach(node => {
        if (node.classList.contains('section-title-wrapper')) {
            currentCollapsed = node.classList.contains('collapsed');
            node.setAttribute('aria-expanded', currentCollapsed ? 'false' : 'true');
            let itemCount = 0, next = node.nextElementSibling;
            while (next && !next.classList.contains('section-title-wrapper') && !next.classList.contains('page-break-wrapper')) {
                if (next.classList.contains('item-row')) itemCount++;
                next = next.nextElementSibling;
            }
            const arrow = node.querySelector('.section-accordion-arrow');
            if (arrow) arrow.style.display = itemCount > 0 ? 'flex' : 'none';
            const countBadge = node.querySelector('.section-count-badge');
            if (countBadge) {
                countBadge.textContent = itemCount > 0 ? `${itemCount}개` : '';
                countBadge.style.display = (currentCollapsed && itemCount > 0) ? 'inline-flex' : 'none';
            }
        } else if (node.classList.contains('page-break-wrapper')) {
            currentCollapsed = false;
        } else if (node.classList.contains('item-row')) {
            if (currentCollapsed) node.classList.add('item-hidden');
            else {
                const wasHidden = node.classList.contains('item-hidden');
                node.classList.remove('item-hidden');
                if (wasHidden) {
                    const ta = node.querySelector('.item-name');
                    if (ta) autoResizeTextarea(ta);
                }
            }
        }
    });

    // 섹션 그룹 클래스 갱신
    const children = Array.from(container.children);
    children.forEach(node => node.classList.remove('in-section', 'section-first', 'section-last', 'has-section-items'));

    let currentSection = null;
    let sectionItems = [];

    const closeGroup = () => {
        if (sectionItems.length > 0) {
            sectionItems[0].classList.add('section-first');
            sectionItems[sectionItems.length - 1].classList.add('section-last');
            if (currentSection) currentSection.classList.add('has-section-items');
        }
        sectionItems = [];
    };

    children.forEach(node => {
        if (node.classList.contains('section-title-wrapper')) {
            closeGroup();
            currentSection = node;
        } else if (node.classList.contains('page-break-wrapper')) {
            closeGroup();
            currentSection = null;
        } else if (node.classList.contains('item-row') && !node.classList.contains('item-hidden') && currentSection) {
            node.classList.add('in-section');
            sectionItems.push(node);
        }
    });
    closeGroup();

    updateEventBadges();
    normalizeInserters();
    updateBookmarkSidebar();
    updateItemsEmptyState();
    updateStatusChip();
}

function updateItemsEmptyState() {
    const container = document.getElementById('itemsContainer');
    if (!container) return;
    const hasItems = Array.from(container.children).some(n =>
        n.classList.contains('item-row') || n.classList.contains('section-title-wrapper') || n.classList.contains('page-break-wrapper')
    );
    let hint = document.getElementById('itemsEmptyHint');
    if (!hasItems) {
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'itemsEmptyHint';
            hint.className = 'items-empty-hint';
            hint.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:#CBD5E1; margin-bottom:2px;">
                    <rect x="3" y="3" width="18" height="18" rx="3"/>
                    <path d="M3 9h18"/><path d="M9 21V9"/>
                </svg>
                <span style="font-weight:700; font-size:14px; color:#8B95A1;">항목이 없습니다</span>
                <span style="font-size:12.5px; color:#ABB3BB; line-height:1.6;">아래 버튼으로 이벤트 항목이나 제목을 추가해 시작하세요</span>`;
            container.appendChild(hint);
        }
    } else {
        if (hint) hint.remove();
    }
}

function normalizeInserters() {
    const container = document.getElementById('itemsContainer');
    if (!container) return;
    const nodes = Array.from(container.children);

    nodes.forEach(node => {
        if (node.classList.contains('hover-break-inserter')) {
            const next = node.nextElementSibling;
            if (!next || !next.classList.contains('section-title-wrapper')) node.remove();
        }
    });

    Array.from(container.children).forEach(node => {
        if (node.classList.contains('section-title-wrapper')) {
            const prev = node.previousElementSibling;
            if (!prev || !prev.classList.contains('hover-break-inserter')) node.before(createHoverBreakInserter());
        }
    });
}

function updateEventBadges() {
    document.getElementById('itemsContainer').querySelectorAll('.section-title-wrapper').forEach((wrapper, index) => {
        const badge = wrapper.querySelector('.event-badge');
        if (badge) badge.textContent = `이벤트 ${index + 1}`;
    });
}

function createHoverBreakInserter() {
    const div = document.createElement('div');
    div.className = 'hover-break-inserter';
    div.innerHTML = `<div class="btn-break-insert">이벤트 나누기 삽입</div>`;
    div.onclick = (e) => { e.stopPropagation(); saveSnapshot(); addPageBreak(div); };
    return div;
}

function addPageBreak(beforeElement = null, undoId = null) {
    const wrapper = document.createElement('div');
    wrapper.className = 'page-break-wrapper';
    wrapper.setAttribute('data-undo-id', sanitizeId(undoId) || generateUniqueId('pb'));
    wrapper.innerHTML = `
        <div class="drag-handle">${DRAG_HANDLE_SVG}</div>
        <div class="page-break-line">✂️ --------------- 다음 이미지로 분리 --------------- ✂️</div>
        <button class="btn-remove js-del-page-break" title="삭제">${CLOSE_SVG_16}</button>
    `;
    const container = document.getElementById('itemsContainer');
    beforeElement ? container.insertBefore(wrapper, beforeElement) : container.appendChild(wrapper);
    initDragAndDrop(wrapper);
    debouncedGenerateImages();
}

function createItemRow(itemName = "", unit = "", price = "", undoId = null) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.setAttribute('data-undo-id', sanitizeId(undoId) || generateUniqueId('item'));
    row.innerHTML = `
        <div class="drag-handle">${DRAG_HANDLE_SVG}</div>
        <div class="item-name-wrapper">
            <textarea class="btn-input item-name auto-resize" placeholder="항목명 (예: <리쥬란 2cc>)">${escapeHtml(itemName)}</textarea>
            <div class="format-toolbar">
                <button class="fmt-btn" data-open="&lt;" data-close="&gt;" title="강조색 적용">&lt;강조&gt;</button>
                <button class="fmt-btn" data-open="&lt;+" data-close="+&gt;" title="글자 확대">&lt;+확대+&gt;</button>
                <button class="fmt-btn" data-open="&lt;-" data-close="-&gt;" title="글자 축소">&lt;-축소-&gt;</button>
                <button class="fmt-btn" data-open="{" data-close="}" title="굵게">{굵게}</button>
            </div>
        </div>
        <input type="text" class="btn-input btn-input-unit item-unit" placeholder="단위" value="${escapeHtml(unit)}">
        <input type="text" class="btn-input btn-input-price item-price" placeholder="금액" value="${escapeHtml(price)}">
        <div class="row-actions" style="display:flex; flex-direction:row; gap:4px;">
            <button class="btn-copy js-dup-item" title="복제">${COPY_SVG_14}</button>
            <button class="btn-remove js-del-item" title="삭제">${CLOSE_SVG_14}</button>
        </div>
    `;
    setTimeout(() => {
        const ta = row.querySelector('.item-name');
        if (ta) autoResizeTextarea(ta);
    }, 0);
    initDragAndDrop(row);
    return row;
}

function addItemRow(itemName = "", unit = "", price = "", undoId = null) {
    document.getElementById('itemsContainer').appendChild(createItemRow(itemName, unit, price, undoId));
    refreshAccordionVisibility();
    debouncedGenerateImages();
}

function autoResizeTextarea(el) {
    const originalTransition = el.style.transition;
    el.style.transition = 'none';
    el.style.height = '38px';
    const borderHeight = el.offsetHeight - el.clientHeight;
    const targetHeight = el.scrollHeight + borderHeight;
    el.style.height = Math.max(38, targetHeight) + 'px';
    el.offsetHeight;
    el.style.transition = originalTransition;
}

function duplicateItemRow(btn) {
    saveSnapshot();
    const currentRow = btn.closest('.item-row');
    currentRow.after(createItemRow(
        currentRow.querySelector('.item-name').value,
        currentRow.querySelector('.item-unit').value,
        currentRow.querySelector('.item-price').value
    ));
    refreshAccordionVisibility();
    debouncedGenerateImages();
}

function duplicateSection(btn) {
    saveSnapshot();
    const currentSection = btn.closest('.section-title-wrapper');
    const items = [];
    let nextNode = currentSection.nextElementSibling;
    while (nextNode && nextNode.classList.contains('item-row')) {
        items.push({
            itemName: nextNode.querySelector('.item-name').value,
            unit: nextNode.querySelector('.item-unit').value,
            price: nextNode.querySelector('.item-price').value
        });
        nextNode = nextNode.nextElementSibling;
    }

    addSectionTitle(
        currentSection.querySelector('.section-title-input').value,
        currentSection.querySelector('.section-title-size').value,
        currentSection.querySelector('.section-title-layout').value,
        currentSection.classList.contains('collapsed'),
        null,
        currentSection.querySelector('.section-body-size')?.value || "25"
    );
    const container = document.getElementById('itemsContainer');
    const newSection = container.lastElementChild;
    if (nextNode) container.insertBefore(newSection, nextNode);

    let insertBeforeNode = newSection.nextElementSibling;
    items.forEach(item => {
        const newRow = createItemRow(item.itemName, item.unit, item.price);
        insertBeforeNode ? container.insertBefore(newRow, insertBeforeNode) : container.appendChild(newRow);
    });
    refreshAccordionVisibility();
    debouncedGenerateImages();
}

function deleteSection(btn) {
    const currentSection = btn.closest('.section-title-wrapper');
    let itemCount = 0;
    let next = currentSection.nextElementSibling;
    while (next && next.classList.contains('item-row')) { itemCount++; next = next.nextElementSibling; }
    if (itemCount > 0) {
        const title = currentSection.querySelector('.section-title-input').value.trim() || '이 섹션';
        if (!confirm(`"${title}" 섹션과 하위 항목 ${itemCount}개를 모두 삭제합니다.\n실행 취소(Ctrl+Z)로 복구할 수 있습니다.`)) return;
    }
    saveSnapshot();
    let nextNode = currentSection.nextElementSibling;
    while (nextNode && nextNode.classList.contains('item-row')) {
        const nodeToRemove = nextNode;
        nextNode = nextNode.nextElementSibling;
        if (lastSelectedItem === nodeToRemove) lastSelectedItem = null;
        nodeToRemove.remove();
    }
    const prevNode = currentSection.previousElementSibling;
    if (prevNode && prevNode.classList.contains('hover-break-inserter')) prevNode.remove();
    if (lastSelectedItem === currentSection) lastSelectedItem = null;
    currentSection.remove();
    refreshAccordionVisibility();
    debouncedGenerateImages();
}

function initSelection() {
    const container = document.getElementById('itemsContainer');
    container.addEventListener('click', (e) => {
        const item = e.target.closest('.item-row, .section-title-wrapper, .page-break-wrapper');
        if (!item || e.target.closest('input, textarea, select, button, .drag-handle')) return;
        handleSelection(e, item);
    });
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.classList.contains('js-toggle-section-opts')) {
            const optsRow = btn.closest('.section-title-wrapper').querySelector('.section-options-row');
            if (optsRow) { optsRow.classList.toggle('open'); btn.classList.toggle('active'); }
        } else if (btn.classList.contains('js-dup-section')) {
            duplicateSection(btn);
        } else if (btn.classList.contains('js-del-section')) {
            deleteSection(btn);
        } else if (btn.classList.contains('js-del-page-break')) {
            saveSnapshot();
            const wrapper = btn.closest('.page-break-wrapper');
            if (lastSelectedItem === wrapper) lastSelectedItem = null;
            wrapper.remove();
            refreshAccordionVisibility();
            debouncedGenerateImages();
        } else if (btn.classList.contains('js-dup-item')) {
            duplicateItemRow(btn);
        } else if (btn.classList.contains('js-del-item')) {
            saveSnapshot();
            const row = btn.closest('.item-row');
            if (lastSelectedItem === row) lastSelectedItem = null;
            row.remove();
            refreshAccordionVisibility();
            debouncedGenerateImages();
        }
    });
    container.addEventListener('mousedown', (e) => {
        if (e.target.closest('.item-row, .section-title-wrapper, .page-break-wrapper') && e.shiftKey) document.body.classList.add('no-select');
    });
    window.addEventListener('mouseup', () => document.body.classList.remove('no-select'));
}

function handleSelection(e, item) {
    const selectableItems = Array.from(document.getElementById('itemsContainer').querySelectorAll('.item-row, .section-title-wrapper, .page-break-wrapper'));
    const currentIndex = selectableItems.indexOf(item);

    if (e.shiftKey && lastSelectedItem && selectableItems.includes(lastSelectedItem)) {
        const start = Math.min(currentIndex, selectableItems.indexOf(lastSelectedItem));
        const end = Math.max(currentIndex, selectableItems.indexOf(lastSelectedItem));
        if (!e.ctrlKey && !e.metaKey) selectableItems.forEach(el => el.classList.remove('item-selected'));
        for (let i = start; i <= end; i++) selectableItems[i].classList.add('item-selected');
    } else if (e.ctrlKey || e.metaKey) {
        item.classList.toggle('item-selected');
    } else {
        selectableItems.forEach(el => el.classList.remove('item-selected'));
        item.classList.add('item-selected');
    }
    lastSelectedItem = item;
}

let dragSrcEl = null, dragGroup = [];
function initDragAndDrop(el) {
    const handle = el.querySelector('.drag-handle');
    if (handle) {
        handle.addEventListener('mouseenter', () => { el.draggable = true; });
        handle.addEventListener('mouseleave', () => { if (!el.classList.contains('dragging')) el.draggable = false; });
        initTouchDrag(el, handle);
    }
    el.addEventListener('dragstart', handleDragStart);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragleave', () => { });
    el.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); return false; });
    el.addEventListener('dragend', handleDragEnd);
}

function initTouchDrag(el, handle) {
    let lastTarget = null;
    let touchStartX = 0, touchStartY = 0, dragConfirmed = false;

    handle.addEventListener('touchstart', (te) => {
        dragSrcEl = el;
        touchStartX = te.touches[0].clientX;
        touchStartY = te.touches[0].clientY;
        dragConfirmed = false;
        const selected = Array.from(document.getElementById('itemsContainer').querySelectorAll('.item-selected'));
        let initialGroup = (el.classList.contains('item-selected') && selected.length > 1) ? selected : [el];
        dragGroup = [];
        initialGroup.forEach(node => {
            if (dragGroup.includes(node)) return;
            if (node.classList.contains('section-title-wrapper')) {
                const prev = node.previousElementSibling;
                if (prev && prev.classList.contains('hover-break-inserter') && !dragGroup.includes(prev)) dragGroup.push(prev);
                dragGroup.push(node);
                let next = node.nextElementSibling;
                while (next && next.classList.contains('item-row')) {
                    if (!dragGroup.includes(next)) dragGroup.push(next);
                    next = next.nextElementSibling;
                }
            } else {
                dragGroup.push(node);
            }
        });
    }, { passive: true });

    handle.addEventListener('touchmove', (te) => {
        const t = te.touches[0];
        if (!dragConfirmed) {
            const dx = Math.abs(t.clientX - touchStartX);
            const dy = Math.abs(t.clientY - touchStartY);
            if (dx < 5 && dy < 5) return;
            dragConfirmed = true;
            dragGroup.forEach(item => item.classList.add('dragging'));
            saveSnapshot();
        }
        te.preventDefault();
        dragGroup.forEach(item => { item.style.pointerEvents = 'none'; });
        const elBelow = document.elementFromPoint(t.clientX, t.clientY);
        dragGroup.forEach(item => { item.style.pointerEvents = ''; });
        if (!elBelow) return;
        const target = elBelow.closest('.item-row, .section-title-wrapper, .page-break-wrapper');
        if (!target || dragGroup.includes(target)) return;
        if (target === lastTarget) return;
        lastTarget = target;
        const rect = target.getBoundingClientRect();
        const isAfter = t.clientY > rect.top + rect.height / 2;
        if (isAfter) {
            let insertAfter = target;
            if (target.classList.contains('section-title-wrapper')) {
                let next = target.nextElementSibling;
                while (next && next.classList.contains('item-row')) { insertAfter = next; next = next.nextElementSibling; }
            }
            dragGroup.forEach(node => { insertAfter.after(node); insertAfter = node; });
        } else {
            dragGroup.forEach((node, idx) => { idx === 0 ? target.before(node) : dragGroup[idx - 1].after(node); });
        }
    }, { passive: false });

    handle.addEventListener('touchend', () => {
        dragGroup.forEach(item => item.classList.remove('dragging'));
        if (dragConfirmed && dragGroup.length > 0) {
            refreshAccordionVisibility();
            debouncedGenerateImages();
            normalizeInserters();
            updateEventBadges();
            updateBookmarkSidebar();
        }
        dragGroup = [];
        dragSrcEl = null;
        lastTarget = null;
        dragConfirmed = false;
        el.draggable = false;
    }, { passive: true });
}

function handleDragStart(e) {
    dragSrcEl = this;
    let initialGroup = this.classList.contains('item-selected') ? Array.from(document.getElementById('itemsContainer').querySelectorAll('.item-selected')) : [this];

    dragGroup = [];
    initialGroup.forEach(node => {
        if (dragGroup.includes(node)) return;
        if (node.classList.contains('section-title-wrapper')) {
            const prev = node.previousElementSibling;
            if (prev && prev.classList.contains('hover-break-inserter') && !dragGroup.includes(prev)) dragGroup.push(prev);
            dragGroup.push(node);
            let next = node.nextElementSibling;
            while (next && next.classList.contains('item-row')) {
                if (!dragGroup.includes(next)) dragGroup.push(next);
                next = next.nextElementSibling;
            }
        } else {
            dragGroup.push(node);
        }
    });
    dragGroup.forEach(el => el.classList.add('dragging'));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    saveSnapshot();
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this === dragSrcEl || dragGroup.includes(this)) return false;
    const rect = this.getBoundingClientRect();
    const isAfter = e.clientY > (rect.top + rect.height / 2);
    if (isAfter) {
        let targetNode = this;
        if (this.classList.contains('section-title-wrapper')) {
            let next = this.nextElementSibling;
            while (next && next.classList.contains('item-row')) { targetNode = next; next = next.nextElementSibling; }
        }
        let lastInserted = targetNode;
        dragGroup.forEach(node => { lastInserted.after(node); lastInserted = node; });
    } else {
        dragGroup.forEach((node, idx) => { idx === 0 ? this.before(node) : dragGroup[idx - 1].after(node); });
    }
    return false;
}

function handleDragEnd() {
    this.draggable = false;
    dragGroup.forEach(item => item.classList.remove('dragging'));
    dragGroup = [];
    refreshAccordionVisibility();
    debouncedGenerateImages();
}

const CONFIG = {
    width: 1000, height: 1000, scale: 2,
    fonts: {
        main: "'Pretendard', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans Thai', sans-serif",
        bold: "'GmarketSansBold', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans Thai', sans-serif",
        medium: "'GmarketSansMedium', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans Thai', sans-serif"
    }
};

document.getElementById('bgInput').addEventListener('change', function (e) {
    saveSnapshot();
    const fileLabel = document.getElementById('fileLabel'), dropZone = document.getElementById('dropZone');
    if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        if (file.size > 20 * 1024 * 1024) {
            alert('이미지 파일 크기는 20MB 이하로 선택해 주세요.');
            e.target.value = '';
            return;
        }
        setFileLabelAttached(file.name);
        dropZone.classList.add('file-attached');
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => { cachedBgImg = img; showBgThumb(event.target.result); debouncedGenerateImages(); };
        };
        reader.readAsDataURL(file);
    } else {
        const main = document.getElementById('fileLabelMain'), sub = document.getElementById('fileLabelSub');
        if (main) main.textContent = '배경 이미지 파일 선택 또는 드래그';
        if (sub) sub.textContent = '';
        dropZone.classList.remove('file-attached');
        cachedBgImg = null;
        hideBgThumb();
        debouncedGenerateImages();
    }
});
document.getElementById('dropZone').addEventListener('click', () => document.getElementById('bgInput').click());
document.getElementById('dropZone').addEventListener('dragover', function (e) { e.preventDefault(); this.classList.add('file-attached'); });
document.getElementById('dropZone').addEventListener('dragleave', function () { if (!cachedBgImg) this.classList.remove('file-attached'); });
document.getElementById('dropZone').addEventListener('drop', function (e) {
    e.preventDefault(); saveSnapshot();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 20 * 1024 * 1024) { alert('이미지 파일 크기는 20MB 이하로 선택해 주세요.'); return; }
    setFileLabelAttached(file.name);
    this.classList.add('file-attached');
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => { cachedBgImg = img; showBgThumb(event.target.result); debouncedGenerateImages(); };
    };
    reader.readAsDataURL(file);
});

async function generateImages() {
    if (!cachedBgImg) return;
    let _removeLoading = null;
    const restoreBtn = () => { if (_removeLoading) { _removeLoading(); _removeLoading = null; } };
    const container = document.getElementById('itemsContainer');
    const pages = [];
    let currentSections = [], currentSection = { title: "", titleSize: "49", bodySize: 25, layout: "horizontal", items: [] }, pageIdx = 0;
    Array.from(container.children).forEach(child => {
        if (child.classList.contains('page-break-wrapper')) {
            if (currentSection.items.length > 0 || currentSection.title !== "") currentSections.push(currentSection);
            if (currentSections.length > 0) { pages.push({ sections: currentSections }); pageIdx++; }
            currentSections = [];
            currentSection = { title: "", titleSize: "49", bodySize: 25, layout: "horizontal", items: [] };
        } else if (child.classList.contains('section-title-wrapper')) {
            if (currentSection.items.length > 0 || currentSection.title !== "") { currentSections.push(currentSection); currentSection = { title: "", titleSize: "49", bodySize: 25, layout: "horizontal", items: [] }; }
            currentSection.title = child.querySelector('.section-title-input').value.trim();
            currentSection.titleSize = child.querySelector('.section-title-size').value;
            currentSection.bodySize = parseInt(child.querySelector('.section-body-size')?.value || 25, 10);
            currentSection.layout = child.querySelector('.section-title-layout').value;
            child.setAttribute('data-page-index', pageIdx);
        } else if (child.classList.contains('item-row')) {
            const itemName = child.querySelector('.item-name').value, unit = child.querySelector('.item-unit').value.trim(), price = child.querySelector('.item-price').value.trim();
            if (itemName || unit || price) currentSection.items.push({ itemName, unit, price });
        }
    });
    if (currentSection.items.length > 0 || currentSection.title !== "") currentSections.push(currentSection);
    if (currentSections.length > 0) pages.push({ sections: currentSections });
    if (pages.length === 0) {
        const pc = document.getElementById('previewContainer');
        const guideMsg = cachedBgImg
            ? '이벤트 항목을 추가하면 이미지가 자동으로 생성됩니다.'
            : '배경 이미지를 선택하면 자동으로 생성됩니다.';
        pc.innerHTML = `<div class="placeholder-text" id="placeholder"><p style="font-size: 40px; margin-bottom: 20px;">🖼️</p>${guideMsg}</div>`;
        generatedImagesUrls = [];
        restoreBtn();
        return;
    }

    const fontsToLoad = ['27px "GmarketSansMedium"', '700 39px "GmarketSansBold"', '700 49px "GmarketSansBold"', '700 59px "GmarketSansBold"', '25px "Pretendard"', '700 25px "Pretendard"', '800 23px "Pretendard"', '800 48px "Pretendard"', '700 29px "Pretendard"', '25px "Noto Sans JP"', '25px "Noto Sans SC"', '25px "Noto Sans TC"', '25px "Noto Sans Thai"'];
    try { await Promise.all(fontsToLoad.map(font => document.fonts.load(font))); } catch (e) { console.warn('일부 폰트 로드 실패:', e); }
    await document.fonts.ready;

    const previewContainer = document.getElementById('previewContainer');
    previewContainer.innerHTML = '';
    generatedImagesUrls = [];
    const loadingEl = document.createElement('div');
    loadingEl.className = 'preview-loading';
    loadingEl.textContent = '🖼️ 이미지 생성 중...';
    previewContainer.appendChild(loadingEl);
    _removeLoading = () => loadingEl.remove();
    const botText = document.getElementById('botText').value.trim();
    const previewWrappers = [];
    pages.forEach(page => {
        const formattedSections = page.sections.map(sec => ({
            title: sec.title, titleSize: sec.titleSize || "49", bodySize: sec.bodySize || 25, layout: sec.layout || "horizontal", groups: convertToGroups(sec.items)
        })).filter(sec => sec.groups.length > 0 || sec.title);

        if (formattedSections.length > 0) {
            let dataUrl;
            try { dataUrl = drawSingleCanvas(cachedBgImg, formattedSections, botText); } catch (e) { restoreBtn(); console.error('캔버스 렌더링 오류:', e); return; }
            const pageIndex = generatedImagesUrls.length;
            generatedImagesUrls.push(dataUrl);
            const wrapper = document.createElement('div');
            wrapper.className = 'preview-img-wrapper';
            const imgEl = document.createElement('img');
            imgEl.src = dataUrl;
            imgEl.alt = `이벤트 이미지 ${generatedImagesUrls.length}페이지`;
            const dlBtn = document.createElement('button');
            dlBtn.className = 'preview-download-btn';
            dlBtn.title = '이 이미지 다운로드';
            dlBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
            dlBtn.onclick = () => {
                const link = document.createElement('a');
                const _t = document.getElementById('topTitle').value.replace(/[\\/:*?"<>|]/g, "_") || "이벤트";
                const _n = new Date();
                const _d = _n.getFullYear().toString() + (_n.getMonth() + 1).toString().padStart(2, '0') + _n.getDate().toString().padStart(2, '0');
                const _ts = _n.getHours().toString().padStart(2, '0') + _n.getMinutes().toString().padStart(2, '0') + _n.getSeconds().toString().padStart(2, '0');
                link.download = `${_t}_${_d}_${_ts}_${(pageIndex + 1).toString().padStart(2, '0')}.jpg`;
                link.href = dataUrl;
                document.body.appendChild(link);
                link.click();
                link.remove();
            };
            const badge = document.createElement('div');
            badge.className = 'preview-page-badge';
            wrapper.appendChild(imgEl);
            wrapper.appendChild(dlBtn);
            wrapper.appendChild(badge);
            previewWrappers.push(wrapper);
            previewContainer.appendChild(wrapper);
        }
    });
    const totalPages = generatedImagesUrls.length;
    if (totalPages === 0) {
        previewContainer.innerHTML = '<div class="placeholder-text" id="placeholder"><p style="font-size: 40px; margin-bottom: 20px;">🖼️</p>배경 이미지를 선택하면 자동으로 생성됩니다.</div>';
        restoreBtn();
        return;
    }
    if (totalPages > 1) {
        previewWrappers.forEach((wrapper, i) => {
            const badge = wrapper.querySelector('.preview-page-badge');
            if (badge) badge.textContent = `${i + 1} / ${totalPages}`;
        });
    }
    document.getElementById('downloadBtn').style.display = 'block';
    restoreBtn();
    updateStatusChip();
}

function convertToGroups(items) {
    const groups = [];
    let currentGroup = null;
    items.forEach(it => {
        if (!currentGroup || currentGroup.item !== it.itemName) {
            currentGroup = { item: it.itemName, rows: [] };
            groups.push(currentGroup);
        }
        currentGroup.rows.push({ unit: it.unit, price: it.price });
    });
    return groups;
}

function downloadAllImages() {
    if (generatedImagesUrls.length === 0) return alert('먼저 이미지를 생성해주세요.');
    if (!isBackedUp && !confirm("⚠️ 아직 백업되지 않은 변경 사항이 있습니다.\n\n[확인] 다운로드를 진행합니다.\n[취소] → [파일 백업] 버튼을 눌러 데이터를 먼저 저장하세요.")) return;
    const topTitle = document.getElementById('topTitle').value.replace(/[\\/:*?"<>|]/g, "_") || "이벤트";
    const now = new Date();
    const dateStr = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0');
    const timeStr = now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0') + now.getSeconds().toString().padStart(2, '0');

    if (generatedImagesUrls.length === 1) {
        const link = document.createElement('a');
        link.download = `${topTitle}_${dateStr}_${timeStr}_01.jpg`;
        link.href = generatedImagesUrls[0];
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } else {
        const zip = new JSZip();
        generatedImagesUrls.forEach((dataUrl, index) => zip.file((index + 1).toString().padStart(2, '0') + ".jpg", dataUrl.replace(/^data:image\/(png|jpeg);base64,/, ""), { base64: true }));
        zip.generateAsync({ type: "blob" }).then(content => saveAs(content, `${topTitle}_${dateStr}_${timeStr}.zip`));
    }
}

function formatPrice(numStr) {
    if (!numStr) return "";
    const clean = numStr.replace(/,/g, '');
    return !isNaN(clean) && clean.trim() !== "" ? Number(clean).toLocaleString('ko-KR') : numStr;
}

function isKorean(text) { return /[가-힣ᄀ-ᇿㄱ-ㆎ]/.test(text); }

function getPriceTokenMeta(ctx, priceStr, baseSize = 25) {
    const tokens = priceStr.match(/[\d.,]+|[^\d.,]+/g) || [];
    let totalWidth = 0;
    const tokenMeta = tokens.map(token => {
        const isNumber = /^[\d.,]+$/.test(token);
        const text = isNumber ? formatPrice(token) : token;
        const font = isNumber ? `800 ${baseSize + 23}px ${CONFIG.fonts.main}` : `700 ${baseSize + 4}px ${CONFIG.fonts.main}`;
        ctx.font = font; ctx.letterSpacing = isNumber ? "-3px" : "-2px";
        let width = ctx.measureText(text).width + (isNumber ? (baseSize / 25) * 3 : 0);
        totalWidth += width;
        return { text, font, color: isNumber ? null : 'black', letterSpacing: isNumber ? "-3px" : "-2px", width, isNumber };
    });
    return { tokenMeta, totalWidth };
}

const SIZE_STEP = 5;

function tokenize(text) {
    const tokens = [];
    let currentText = "";
    let i = 0;

    const pushText = () => {
        if (currentText) {
            tokens.push({ type: 'TEXT', value: currentText });
            currentText = "";
        }
    };

    while (i < text.length) {
        if (text[i] === '<') {
            pushText();
            let plusCount = 0;
            let minusCount = 0;
            let j = i + 1;
            while (j < text.length && text[j] === '+') { plusCount++; j++; }
            if (plusCount === 0) {
                while (j < text.length && text[j] === '-') { minusCount++; j++; }
            }
            tokens.push({ type: 'OPEN_ANGLE', sizeDelta: plusCount > 0 ? plusCount : -minusCount, rawLength: j - i });
            i = j;
        } else if (text[i] === '>' && (i === 0 || text[i - 1] !== '=')) {
            let plusCount = 0;
            let minusCount = 0;

            let k = currentText.length - 1;
            while (k >= 0 && currentText[k] === '+') { plusCount++; k--; }
            if (plusCount === 0) {
                while (k >= 0 && currentText[k] === '-') { minusCount++; k--; }
            }

            if (plusCount > 0 || minusCount > 0) {
                currentText = currentText.substring(0, k + 1);
            }
            pushText();

            tokens.push({ type: 'CLOSE_ANGLE', sizeDelta: plusCount > 0 ? plusCount : -minusCount });
            i++;
        } else if (text[i] === '{') {
            pushText();
            tokens.push({ type: 'OPEN_BRACE' });
            i++;
        } else if (text[i] === '}') {
            pushText();
            tokens.push({ type: 'CLOSE_BRACE' });
            i++;
        } else {
            currentText += text[i];
            i++;
        }
    }
    pushText();
    return tokens;
}

function parse(tokens) {
    let pos = 0;

    function parseBlock() {
        const nodes = [];
        while (pos < tokens.length) {
            const token = tokens[pos];
            if (token.type === 'TEXT') {
                nodes.push({ type: 'TEXT', value: token.value });
                pos++;
            } else if (token.type === 'OPEN_ANGLE') {
                pos++;
                const children = parseBlock();

                let closeDelta = 0;
                if (pos < tokens.length && tokens[pos].type === 'CLOSE_ANGLE') {
                    closeDelta = tokens[pos].sizeDelta;
                    pos++;
                }

                nodes.push({
                    type: 'ANGLE',
                    sizeDelta: token.sizeDelta || closeDelta,
                    children: children
                });
            } else if (token.type === 'OPEN_BRACE') {
                pos++;
                const children = parseBlock();
                if (pos < tokens.length && tokens[pos].type === 'CLOSE_BRACE') {
                    pos++;
                }
                nodes.push({
                    type: 'BRACE',
                    children: children
                });
            } else if (token.type === 'CLOSE_ANGLE' || token.type === 'CLOSE_BRACE') {
                break;
            }
        }
        return nodes;
    }

    return parseBlock();
}

function flattenAST(nodes, currentState) {
    let chunks = [];
    for (const node of nodes) {
        if (node.type === 'TEXT') {
            if (node.value) {
                chunks.push({
                    text: node.value,
                    isHighlight: currentState.isHighlight,
                    sizeDelta: currentState.sizeDelta,
                    boldLevel: currentState.boldLevel
                });
            }
        } else if (node.type === 'ANGLE') {
            const newState = {
                ...currentState,
                isHighlight: currentState.isHighlight || (node.sizeDelta === 0),
                sizeDelta: currentState.sizeDelta + node.sizeDelta
            };
            chunks = chunks.concat(flattenAST(node.children, newState));
        } else if (node.type === 'BRACE') {
            const newState = {
                ...currentState,
                boldLevel: currentState.boldLevel + 1
            };
            chunks = chunks.concat(flattenAST(node.children, newState));
        }
    }
    return chunks;
}

function parseStyledText(text) {
    text = String(text || '');
    const tokens = tokenize(text);
    const ast = parse(tokens);
    const initialState = { isHighlight: false, sizeDelta: 0, boldLevel: 0 };
    const chunks = flattenAST(ast, initialState);

    const mergedChunks = [];
    let current = null;
    for (const chunk of chunks) {
        if (!current) {
            current = { ...chunk };
        } else if (current.isHighlight === chunk.isHighlight &&
            current.sizeDelta === chunk.sizeDelta &&
            current.boldLevel === chunk.boldLevel) {
            current.text += chunk.text;
        } else {
            mergedChunks.push(current);
            current = { ...chunk };
        }
    }
    if (current) mergedChunks.push(current);

    return mergedChunks;
}

function getWeightFromLevel(level, text) {
    if (level >= 2) return 900;
    if (level === 1) return 800;
    return isKorean(text) ? 700 : 500;
}

function wrapTextChunks(ctx, text, maxWidth, baseSize = 27, isTitle = false) {
    text = String(text || '');
    if (text === '') return [{ chunks: [], totalWidth: 0 }];

    const lines = [];
    const chunks = parseStyledText(text);

    let currentLineChunks = [];
    let currentLineWidth = 0;

    for (const chunk of chunks) {
        const currentSize = Math.max(10, baseSize + (chunk.sizeDelta * SIZE_STEP));
        const boldWeight = getWeightFromLevel(chunk.boldLevel, chunk.text);
        const chunkFont = isTitle ? `${boldWeight} ${currentSize}px 'GmarketSansBold', ${CONFIG.fonts.main}` : `${boldWeight} ${currentSize}px ${CONFIG.fonts.main}`;
        ctx.font = chunkFont;

        let chunkText = chunk.text;
        let subChunkText = '';

        for (let i = 0; i < chunkText.length; i++) {
            const char = chunkText[i];

            if (char === '\n') {
                if (subChunkText) {
                    const w = ctx.measureText(subChunkText).width;
                    currentLineChunks.push({ ...chunk, text: subChunkText, width: w, font: chunkFont });
                    currentLineWidth += w;
                }
                lines.push({ chunks: currentLineChunks, totalWidth: currentLineWidth });
                currentLineChunks = [];
                currentLineWidth = 0;
                subChunkText = '';
                continue;
            }

            const testText = subChunkText + char;
            const testWidth = ctx.measureText(testText).width;
            const hasVisibleChars = currentLineWidth > 0 || subChunkText.length > 0;

            if (currentLineWidth + testWidth > maxWidth && hasVisibleChars) {
                if (subChunkText) {
                    const w = ctx.measureText(subChunkText).width;
                    currentLineChunks.push({ ...chunk, text: subChunkText, width: w, font: chunkFont });
                    currentLineWidth += w;
                }
                lines.push({ chunks: currentLineChunks, totalWidth: currentLineWidth });

                currentLineChunks = [];
                currentLineWidth = 0;
                subChunkText = char;
            } else {
                subChunkText = testText;
            }
        }

        if (subChunkText) {
            const w = ctx.measureText(subChunkText).width;
            currentLineChunks.push({ ...chunk, text: subChunkText, width: w, font: chunkFont });
            currentLineWidth += w;
        }
    }

    if (currentLineChunks.length > 0 || text.endsWith('\n')) {
        lines.push({ chunks: currentLineChunks, totalWidth: currentLineWidth });
    }

    return lines;
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius); ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath(); ctx.fill();
}

function drawSingleCanvas(bgImg, sections, botText) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scale = CONFIG.scale;
    canvas.width = CONFIG.width * scale;
    canvas.height = CONFIG.height * scale;
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const startX = 105, endX = 895, unitPriceGap = 25;
    let totalSectionsHeight = 0, canvasMaxPriceWidth = 0, canvasMaxUnitW = 0;
    sections.forEach(sec => {
        const baseSize = sec.bodySize || 25;
        sec.groups.forEach(group => {
            group.localMaxPriceWidth = 0;
            group.rows.forEach(r => {
                r.priceMeta = getPriceTokenMeta(ctx, r.price, baseSize);
                if (r.priceMeta.totalWidth > group.localMaxPriceWidth) group.localMaxPriceWidth = r.priceMeta.totalWidth;
            });
            if (group.localMaxPriceWidth > canvasMaxPriceWidth) canvasMaxPriceWidth = group.localMaxPriceWidth;

            group.maxUnitW = 0;
            group.rows.forEach(r => {
                if (r.unit) {
                    ctx.font = `800 ${baseSize - 2}px ${CONFIG.fonts.main}`;
                    ctx.letterSpacing = "0px";
                    const w = ctx.measureText(r.unit).width + (baseSize / 25) * 28;
                    if (w > group.maxUnitW) group.maxUnitW = w;
                }
            });
            if (group.maxUnitW > canvasMaxUnitW) canvasMaxUnitW = group.maxUnitW;
        });
    });

    sections.forEach((sec, sIdx) => {
        const baseSize = sec.bodySize || 25;
        sec.metrics = {
            secTextLineGap: Math.round(baseSize * 1.32),
            secGroupRowGap: Math.round(baseSize * 2.0),
            secPriceAreaTopPadding: Math.round(baseSize * 2.4),
            secItemHalfHeight: Math.round(baseSize * 0.96),
            verticalLineGap: Math.round(baseSize * 4.4),
            horizontalLineGap: Math.round(baseSize * 2.6),
            secItemFont: `700 ${baseSize + 2}px ${CONFIG.fonts.main}`,
            baseSize
        };

        let totalListHeight = 0;
        sec.groups.forEach((group, index) => {
            ctx.font = sec.metrics.secItemFont;
            ctx.letterSpacing = "-1px";

            if (sec.layout === "vertical") {
                group.lines = wrapTextChunks(ctx, group.item, 800, baseSize, false);
                group.heightSpan = ((group.lines.length - 1) * sec.metrics.secTextLineGap) + (group.rows.length > 0 ? ((group.rows.length - 1) * sec.metrics.secGroupRowGap + sec.metrics.secPriceAreaTopPadding) : 0);
            } else {
                const maxTextWidth = (endX - canvasMaxPriceWidth - unitPriceGap - (group.maxUnitW > 0 ? group.maxUnitW + 15 : 5)) - startX;
                group.lines = wrapTextChunks(ctx, group.item, maxTextWidth, baseSize, false);
                group.heightSpan = Math.max((group.rows.length - 1) * sec.metrics.secGroupRowGap, (group.lines.length - 1) * sec.metrics.secTextLineGap);
            }
            totalListHeight += group.heightSpan + (index < sec.groups.length - 1 ? (sec.layout === 'vertical' ? sec.metrics.verticalLineGap : sec.metrics.horizontalLineGap) : 0);
        });

        sec.totalListHeight = totalListHeight;

        const tSize = Number(sec.titleSize || 49);
        ctx.font = `700 ${tSize}px 'GmarketSansBold', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans Thai', sans-serif`;
        ctx.letterSpacing = "-2px";

        sec.titleLines = sec.title ? wrapTextChunks(ctx, sec.title, 800, tSize, true) : [];
        sec.bannerHeight = sec.title ? (sec.titleLines.length * (tSize * 1.0) + (tSize * 0.95)) : 0;
        sec.whiteBoxHeight = sec.groups.length > 0 ? ((sec.layout === 'vertical' ? 60 : 15) * 2 + sec.metrics.secItemHalfHeight * 2 + totalListHeight) : 0;
        sec.totalSectionHeight = sec.bannerHeight + sec.whiteBoxHeight;
        totalSectionsHeight += sec.totalSectionHeight + (sIdx < sections.length - 1 ? 10 : 0);
    });

    const eventBoxStartY = CONFIG.height / 2 - (totalSectionsHeight / 2);
    const imgRatio = bgImg.width / bgImg.height;
    const canvasRatio = CONFIG.width / CONFIG.height;
    let sx = 0, sy = 0, sw = bgImg.width, sh = bgImg.height;
    if (imgRatio > canvasRatio) { sw = bgImg.height * canvasRatio; sx = (bgImg.width - sw) / 2; }
    else { sh = bgImg.width / canvasRatio; sy = (bgImg.height - sh) / 2; }
    ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, CONFIG.width, CONFIG.height);

    const themeColor = document.getElementById('themeHex').value;

    const drawWrappedCentered = (text, centerX, startY, maxWidth, lineHeight) => {
        const paragraphs = String(text || '').split('\n');
        let cy = startY;
        ctx.textAlign = 'center';
        paragraphs.forEach(para => {
            if (!para) { cy += lineHeight; return; }
            let line = '';
            for (const ch of para) {
                const test = line + ch;
                if (ctx.measureText(test).width > maxWidth && line) {
                    ctx.fillText(line, centerX, cy);
                    cy += lineHeight;
                    line = ch;
                } else { line = test; }
            }
            if (line) { ctx.fillText(line, centerX, cy); cy += lineHeight; }
        });
    };

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = themeColor;
    ctx.font = `27px 'GmarketSansMedium', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans Thai', sans-serif`;
    ctx.letterSpacing = "-1px";
    drawWrappedCentered(document.getElementById('topTitle').value, CONFIG.width / 2, Math.min(eventBoxStartY - 60, Math.round(CONFIG.height * 0.08)), 880, 34);
    drawWrappedCentered(document.getElementById('topDate').value, CONFIG.width / 2, Math.min(eventBoxStartY - 25, Math.round(CONFIG.height * 0.115)), 880, 34);

    let currentSectionY = eventBoxStartY;
    sections.forEach(sec => {
        let whiteBoxTop = currentSectionY;

        if (sec.title) {
            ctx.fillStyle = themeColor;
            ctx.fillRect(60, currentSectionY, 880, sec.bannerHeight);

            ctx.textAlign = "left";
            ctx.textBaseline = "middle";

            const tSize = Number(sec.titleSize || 49);
            const titleStartY = currentSectionY + (sec.bannerHeight / 2) - ((sec.titleLines.length - 1) * (tSize * 1.0)) / 2;

            sec.titleLines.forEach((lineObj, i) => {
                let currentX = 500 - lineObj.totalWidth / 2;

                lineObj.chunks.forEach(chunk => {
                    ctx.font = chunk.font;
                    ctx.fillStyle = "white";
                    ctx.fillText(chunk.text, currentX, titleStartY + (i * (tSize * 1.0)));
                    currentX += chunk.width;
                });
            });

            whiteBoxTop += sec.bannerHeight;
        }

        if (sec.groups.length > 0) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            ctx.fillRect(60, whiteBoxTop, 880, sec.whiteBoxHeight);
            ctx.strokeStyle = themeColor;
            ctx.lineWidth = 2;
            ctx.strokeRect(61, whiteBoxTop, 878, sec.whiteBoxHeight - 1);
            ctx.textBaseline = "middle";

            let currentY = whiteBoxTop + (sec.layout === 'vertical' ? Math.round(sec.metrics.baseSize * 2.0) : Math.round(sec.metrics.baseSize * 0.6)) + sec.metrics.secItemHalfHeight;

            sec.groups.forEach((group, index) => {
                ctx.textAlign = "left";
                ctx.letterSpacing = "-1px";

                if (sec.layout === "vertical") {
                    group.lines.forEach((lineObj, i) => {
                        let currentX = 500 - lineObj.totalWidth / 2;
                        lineObj.chunks.forEach(chunk => {
                            ctx.font = chunk.font;
                            ctx.fillStyle = chunk.isHighlight ? themeColor : "black";
                            ctx.fillText(chunk.text, currentX, currentY + (i * sec.metrics.secTextLineGap));
                            currentX += chunk.width;
                        });
                    });

                    let priceStartY = currentY + ((group.lines.length - 1) * sec.metrics.secTextLineGap) + sec.metrics.secPriceAreaTopPadding;
                    const groupRightX = 500 + (group.maxUnitW + (group.maxUnitW > 0 ? 15 : 0) + group.localMaxPriceWidth) / 2;

                    group.rows.forEach((row, rowIndex) => {
                        const rowCenterY = priceStartY + (rowIndex * sec.metrics.secGroupRowGap);

                        if (group.maxUnitW > 0 && row.unit) {
                            const boxX = (groupRightX - group.localMaxPriceWidth - 15) - group.maxUnitW;
                            ctx.fillStyle = themeColor;
                            roundRect(ctx, boxX, rowCenterY - (sec.metrics.baseSize / 25) * 20, group.maxUnitW, (sec.metrics.baseSize / 25) * 40, 10);
                            ctx.font = `800 ${sec.metrics.baseSize - 2}px ${CONFIG.fonts.main}`;
                            ctx.textAlign = "center";
                            ctx.fillStyle = "white";
                            ctx.letterSpacing = "0px";
                            ctx.fillText(row.unit, boxX + group.maxUnitW / 2, rowCenterY + 2);
                        }

                        let currentX = groupRightX - row.priceMeta.totalWidth;
                        ctx.textBaseline = "alphabetic";
                        ctx.textAlign = "left";

                        row.priceMeta.tokenMeta.forEach(meta => {
                            ctx.font = meta.font;
                            ctx.fillStyle = meta.color || themeColor;
                            ctx.letterSpacing = meta.letterSpacing;
                            ctx.fillText(meta.text, currentX, rowCenterY + (sec.metrics.baseSize / 25) * 18);
                            currentX += meta.width;
                        });
                        ctx.textBaseline = "middle";
                    });
                } else {
                    const groupCenterY = currentY + group.heightSpan / 2;

                    group.lines.forEach((lineObj, i) => {
                        let currentX = startX;
                        lineObj.chunks.forEach(chunk => {
                            ctx.font = chunk.font;
                            ctx.fillStyle = chunk.isHighlight ? themeColor : "black";
                            ctx.fillText(chunk.text, currentX, groupCenterY - ((group.lines.length - 1) * sec.metrics.secTextLineGap) / 2 + (i * sec.metrics.secTextLineGap));
                            currentX += chunk.width;
                        });
                    });

                    group.rows.forEach((row, rowIndex) => {
                        const rowCenterY = groupCenterY - ((group.rows.length - 1) * sec.metrics.secGroupRowGap) / 2 + (rowIndex * sec.metrics.secGroupRowGap);

                        if (row.unit) {
                            const boxX = (endX - canvasMaxPriceWidth - unitPriceGap) - group.maxUnitW;
                            ctx.fillStyle = themeColor;
                            roundRect(ctx, boxX, rowCenterY - (sec.metrics.baseSize / 25) * 20, group.maxUnitW, (sec.metrics.baseSize / 25) * 40, 10);
                            ctx.font = `800 ${sec.metrics.baseSize - 2}px ${CONFIG.fonts.main}`;
                            ctx.textAlign = "center";
                            ctx.fillStyle = "white";
                            ctx.letterSpacing = "0px";
                            ctx.fillText(row.unit, boxX + group.maxUnitW / 2, rowCenterY + 2);
                        }

                        let currentX = endX - row.priceMeta.totalWidth;
                        ctx.textBaseline = "alphabetic";
                        ctx.textAlign = "left";

                        row.priceMeta.tokenMeta.forEach(meta => {
                            ctx.font = meta.font;
                            ctx.fillStyle = meta.color || themeColor;
                            ctx.letterSpacing = meta.letterSpacing;
                            ctx.fillText(meta.text, currentX, rowCenterY + 18);
                            currentX += meta.width;
                        });
                        ctx.textBaseline = "middle";
                    });
                }

                if (index < sec.groups.length - 1) {
                    let halfGap = (sec.layout === "vertical" ? sec.metrics.verticalLineGap : sec.metrics.horizontalLineGap) / 2;
                    ctx.beginPath();
                    ctx.moveTo(startX, currentY + group.heightSpan + halfGap);
                    ctx.lineTo(endX, currentY + group.heightSpan + halfGap);
                    ctx.strokeStyle = themeColor;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    currentY += group.heightSpan + halfGap * 2;
                }
            });
        }
        currentSectionY += sec.totalSectionHeight + 10;
    });

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = themeColor;
    ctx.font = `23px 'GmarketSansMedium', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans Thai', sans-serif`;
    ctx.letterSpacing = "0px";
    drawWrappedCentered(botText, CONFIG.width / 2, Math.min(Math.max(currentSectionY + 23, CONFIG.height - 25), CONFIG.height - 10), 880, 30);

    return canvas.toDataURL('image/jpeg', 0.97);
}

/* ============================================================
 * 색상 슬롯 저장/불러오기
 * ============================================================ */
function loadColorSlots() {
    try {
        const saved = JSON.parse(localStorage.getItem('colorSlots'));
        if (Array.isArray(saved) && saved.length <= 6 && saved.every(c => /^#[0-9A-Fa-f]{6}$/.test(c)))
            return saved;
    } catch(e) {}
    return [];
}

function saveColorSlots(slots) {
    localStorage.setItem('colorSlots', JSON.stringify(slots));
}

function renderColorPresets() {
    const container = document.getElementById('colorPresets');
    if (!container) return;
    const slots = loadColorSlots();
    const currentColor = document.getElementById('themeHex').value.toUpperCase();

    container.innerHTML = '';

    if (slots.length < 6) {
        const addBtn = document.createElement('button');
        addBtn.className = 'preset-add-btn';
        addBtn.id = 'presetAddBtn';
        addBtn.title = '현재 색상 저장 (최대 6개)';
        addBtn.textContent = '+';
        container.appendChild(addBtn);
    }

    if (slots.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'color-preset-hint';
        hint.textContent = '버튼으로 현재 색상을 저장하세요';
        container.appendChild(hint);
    }

    slots.forEach((color, i) => {
        const btn = document.createElement('button');
        btn.className = 'preset-swatch' + (color.toUpperCase() === currentColor ? ' active' : '');
        btn.setAttribute('data-color', color);
        btn.setAttribute('data-slot', String(i));
        btn.title = color;
        btn.style.backgroundColor = color;
        const del = document.createElement('span');
        del.className = 'swatch-delete';
        del.setAttribute('data-delete', String(i));
        del.textContent = '×';
        btn.appendChild(del);
        container.appendChild(btn);
    });
}

function syncPresetActive(color) {
    const upper = color.toUpperCase();
    document.querySelectorAll('.preset-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color.toUpperCase() === upper);
    });
}

function showColorToast(msg) {
    let toast = document.getElementById('colorToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'colorToast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

/* ============================================================
 * 북마크 사이드바 fixed 포지셔닝
 * ============================================================ */
function positionBookmarkSidebar() {
    const sidebar = document.getElementById('bookmarkSidebar');
    const anchor = document.querySelector('.input-card');
    if (!sidebar || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    sidebar.style.left = Math.max(4, rect.left - 148) + 'px';
}

/* ============================================================
 * 페이지 초기화 및 이벤트 위임 (최적화)
 * ============================================================ */
window.onload = () => {
    const hexInput = document.getElementById('themeHex'), colorPicker = document.getElementById('themeColor'), swatch = document.getElementById('themeSwatch');
    colorPicker.addEventListener('input', (e) => {
        const color = e.target.value;
        hexInput.value = color.toUpperCase();
        swatch.style.backgroundColor = color;
        syncPresetActive(color);
        document.documentElement.style.setProperty('--h1-bar-color', color);
    });
    hexInput.addEventListener('input', (e) => {
        let color = e.target.value;
        if (!color.startsWith('#')) color = '#' + color;
        if (/^#[0-9A-F]{6}$/i.test(color)) {
            hexInput.value = color;
            colorPicker.value = color;
            swatch.style.backgroundColor = color;
            syncPresetActive(color);
            document.documentElement.style.setProperty('--h1-bar-color', color);
        }
    });
    swatch.addEventListener('click', () => colorPicker.click());
    [hexInput, colorPicker].forEach(input => input.addEventListener('input', debouncedGenerateImages));

    ['topTitle', 'topDate', 'botText'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                autoResizeTextarea(el);
                updateViolationUI(el);
                debouncedGenerateImages();
                handleInputSnapshot();
            });
            el.addEventListener('paste', () => setTimeout(() => { updateViolationUI(el); saveSnapshot(); }, 0));
            el.addEventListener('focus', () => { el._beforeValue = el.value; });
            el.addEventListener('blur', () => { if (el._beforeValue !== el.value) { const current = el.value; el.value = el._beforeValue; saveSnapshot(); el.value = current; } });
            autoResizeTextarea(el);
            updateViolationUI(el);
        }
    });

    ['themeHex', 'themeColor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('focus', () => { el._beforeValue = el.value; });
            el.addEventListener('blur', () => { if (el._beforeValue !== el.value) { const current = el.value; el.value = el._beforeValue; saveSnapshot(); el.value = current; } });
        }
    });

    const container = document.getElementById('itemsContainer');
    container.addEventListener('input', (e) => {
        if (e.target.matches('.btn-input')) {
            if (e.target.tagName === 'TEXTAREA') autoResizeTextarea(e.target);
            if (e.target.classList.contains('section-title-input')) {
                updateBookmarkSidebar();
                updateViolationUI(e.target);
            }
            if (e.target.classList.contains('item-name')) updateViolationUI(e.target);
            debouncedGenerateImages();
            handleInputSnapshot();
        }
    });

    container.addEventListener('mousedown', (e) => {
        const btn = e.target.closest('.fmt-btn');
        if (!btn) return;
        e.preventDefault();
        const textarea = btn.closest('.item-name-wrapper')?.querySelector('.item-name, .section-title-input');
        if (!textarea) return;
        const open = btn.dataset.open;
        const close = btn.dataset.close;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);
        textarea.value = textarea.value.substring(0, start) + open + selected + close + textarea.value.substring(end);
        const cursor = selected ? start + open.length + selected.length + close.length : start + open.length;
        textarea.setSelectionRange(cursor, cursor);
        textarea.focus();
        autoResizeTextarea(textarea);
        updateViolationUI(textarea);
        debouncedGenerateImages();
        handleInputSnapshot();
    });

    container.addEventListener('change', (e) => {
        if (e.target.matches('select.btn-input')) {
            const current = e.target.value;
            e.target.value = e.target._beforeValue;
            saveSnapshot();
            e.target.value = current;
            e.target._beforeValue = current;
            debouncedGenerateImages();
        }
    });
    container.addEventListener('paste', (e) => { if (e.target.matches('.btn-input')) setTimeout(() => { if (e.target.classList.contains('item-name') || e.target.classList.contains('section-title-input')) updateViolationUI(e.target); saveSnapshot(); }, 0); });
    container.addEventListener('focusin', (e) => { if (e.target.matches('.btn-input')) { e.target._beforeValue = e.target.value; if (e.target.tagName !== 'SELECT') updateViolationUI(e.target); } });
    container.addEventListener('focusout', (e) => {
        if (e.target.matches('.btn-input')) {
            if (e.target._beforeValue !== e.target.value) saveSnapshot();
        }
    });

    renderColorPresets();

    document.getElementById('colorPresets')?.addEventListener('click', (e) => {
        // 삭제 버튼
        if (e.target.classList.contains('swatch-delete')) {
            const idx = parseInt(e.target.dataset.delete);
            const slots = loadColorSlots();
            slots.splice(idx, 1);
            saveColorSlots(slots);
            renderColorPresets();
            return;
        }
        // + 추가 버튼
        if (e.target.closest('#presetAddBtn')) {
            const currentColor = document.getElementById('themeHex').value.toUpperCase();
            if (!/^#[0-9A-Fa-f]{6}$/.test(currentColor)) return;
            const slots = loadColorSlots();
            if (slots.length >= 6) return;
            if (slots.map(c => c.toUpperCase()).includes(currentColor)) {
                showColorToast('이미 저장된 색상입니다');
                return;
            }
            slots.push(currentColor);
            saveColorSlots(slots);
            renderColorPresets();
            showColorToast(`${currentColor} 저장됨`);
            return;
        }
        // 색상 적용
        const swatch = e.target.closest('.preset-swatch');
        if (!swatch) return;
        updateColorSync('theme', swatch.dataset.color);
        debouncedGenerateImages();
        saveSnapshot();
    });

    container.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const target = e.target;
        const row = target.closest('.item-row');
        if (!row) return;

        if (!e.shiftKey) {
            // 정방향: name → unit → price → 다음 행 name
            if (target.classList.contains('item-name')) {
                e.preventDefault();
                row.querySelector('.item-unit')?.focus();
            } else if (target.classList.contains('item-unit')) {
                e.preventDefault();
                row.querySelector('.item-price')?.focus();
            } else if (target.classList.contains('item-price')) {
                const allRows = Array.from(document.querySelectorAll('.item-row'));
                const idx = allRows.indexOf(row);
                if (idx !== -1 && idx < allRows.length - 1) {
                    e.preventDefault();
                    allRows[idx + 1].querySelector('.item-name')?.focus();
                }
            }
        } else {
            // 역방향: name → 이전 행 price → unit → name
            if (target.classList.contains('item-unit')) {
                e.preventDefault();
                row.querySelector('.item-name')?.focus();
            } else if (target.classList.contains('item-price')) {
                e.preventDefault();
                row.querySelector('.item-unit')?.focus();
            } else if (target.classList.contains('item-name')) {
                const allRows = Array.from(document.querySelectorAll('.item-row'));
                const idx = allRows.indexOf(row);
                if (idx > 0) {
                    e.preventDefault();
                    allRows[idx - 1].querySelector('.item-price')?.focus();
                }
            }
        }
    });

    restoreFromSessionStorage();

    updateRemoteState();
    initSelection();
    initStaticHandlers();

    const bookmarkEl = document.getElementById('bookmarkSidebar');
    if (bookmarkEl) document.body.appendChild(bookmarkEl);
    positionBookmarkSidebar();
    window.addEventListener('resize', positionBookmarkSidebar, { passive: true });
};

let debounceTimer, autoSaveTimer;
function debouncedGenerateImages() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => generateImages(), 300);
    markUnsaved(); scheduleAutoSave();
}

function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => saveToSessionStorage(), 1000);
}

function updateColorSync(prefix, color) {
    document.getElementById(prefix + 'Hex').value = color.toUpperCase();
    document.getElementById(prefix + 'Color').value = color;
    document.getElementById(prefix + 'Swatch').style.backgroundColor = color;
    if (prefix === 'theme') {
        syncPresetActive(color);
        document.documentElement.style.setProperty('--h1-bar-color', color);
    }
}

function updateStatusChip() {
    const chip = document.getElementById('statusChip');
    if (!chip) return;
    const container = document.getElementById('itemsContainer');
    const itemCount = container.querySelectorAll('.item-row:not(.item-hidden)').length;
    const imageCount = generatedImagesUrls.length;
    if (itemCount === 0 && imageCount === 0) { chip.textContent = ''; return; }
    const pageBreaks = container.querySelectorAll('.page-break-wrapper').length;
    const estimatedImages = imageCount > 0 ? imageCount : (pageBreaks + 1);
    const parts = [];
    if (itemCount > 0) parts.push(`항목 ${itemCount}개`);
    parts.push(`이미지 ${estimatedImages}장${imageCount === 0 && itemCount > 0 ? ' 예상' : ''}`);
    chip.textContent = parts.join(' · ');
}

function setFileLabelAttached(filename) {
    const main = document.getElementById('fileLabelMain');
    const sub = document.getElementById('fileLabelSub');
    if (main) main.textContent = filename;
    if (sub) sub.textContent = '클릭하여 변경';
}

function setRatio(w, h, btn) {
    saveSnapshot();
    CONFIG.width = w;
    CONFIG.height = h;
    document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    debouncedGenerateImages();
}

function showBgThumb(src) {
    const thumb = document.getElementById('bgThumb');
    if (!thumb) return;
    thumb.src = src;
    thumb.style.display = 'block';
    document.getElementById('dropZone').classList.add('has-thumb');
}

function hideBgThumb() {
    const thumb = document.getElementById('bgThumb');
    if (!thumb) return;
    thumb.src = '';
    thumb.style.display = 'none';
    document.getElementById('dropZone').classList.remove('has-thumb');
}


function openShortcutModal() {
    document.getElementById('shortcutModalOverlay')?.classList.add('open');
}

function closeShortcutModal() {
    document.getElementById('shortcutModalOverlay')?.classList.remove('open');
}

window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey, isZ = e.code === 'KeyZ' || e.key.toLowerCase() === 'z', isY = e.code === 'KeyY' || e.key.toLowerCase() === 'y', shift = e.shiftKey;
    const isInputMode = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (isInputMode && ctrl && (isZ || isY)) return;

    if (e.key === 'Escape') { closeShortcutModal(); return; }
    if (ctrl && isZ && !shift) { e.preventDefault(); undo(); }
    else if ((ctrl && isZ && shift) || (ctrl && isY)) { e.preventDefault(); redo(); }
    else if (ctrl && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) { e.preventDefault(); saveProject(); }
    else if (e.key === 'Delete' || (e.key === 'Backspace' && !ctrl)) {
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'SELECT') return;
        const selectedItems = document.querySelectorAll('#itemsContainer .item-selected');
        if (selectedItems.length === 0) return;

        e.preventDefault();

        let sectionsWithItems = 0, totalChildItems = 0, firstSectionTitle = '';
        selectedItems.forEach(item => {
            if (item.classList.contains('section-title-wrapper')) {
                let childCount = 0, next = item.nextElementSibling;
                while (next && next.classList.contains('item-row')) { childCount++; next = next.nextElementSibling; }
                if (childCount > 0) {
                    if (sectionsWithItems === 0) firstSectionTitle = item.querySelector('.section-title-input')?.value.trim() || '이 섹션';
                    sectionsWithItems++;
                    totalChildItems += childCount;
                }
            }
        });
        if (sectionsWithItems > 0) {
            const msg = sectionsWithItems === 1
                ? `"${firstSectionTitle}" 섹션과 하위 항목 ${totalChildItems}개를 모두 삭제합니다.\n실행 취소(Ctrl+Z)로 복구할 수 있습니다.`
                : `섹션 ${sectionsWithItems}개와 하위 항목 ${totalChildItems}개를 포함한 선택 항목을 모두 삭제합니다.\n실행 취소(Ctrl+Z)로 복구할 수 있습니다.`;
            if (!confirm(msg)) return;
        }

        saveSnapshot();
        const toRemove = new Set();
        selectedItems.forEach(item => {
            toRemove.add(item);
            if (item.classList.contains('section-title-wrapper')) {
                const prev = item.previousElementSibling;
                if (prev?.classList.contains('hover-break-inserter')) toRemove.add(prev);
                let next = item.nextElementSibling;
                while (next && next.classList.contains('item-row')) { toRemove.add(next); next = next.nextElementSibling; }
            }
        });
        toRemove.forEach(node => { if (lastSelectedItem === node) lastSelectedItem = null; node.remove(); });
        refreshAccordionVisibility(); debouncedGenerateImages();
    }
});

window.addEventListener('beforeunload', (e) => { if (!isBackedUp) { e.preventDefault(); e.returnValue = ''; } });

function initStaticHandlers() {
    // ratio buttons
    document.querySelectorAll('.ratio-btn').forEach(btn => {
        btn.addEventListener('click', () => setRatio(Number(btn.dataset.w), Number(btn.dataset.h), btn));
    });

    // theme color container — focus hex input on click
    document.getElementById('themeColorContainer')?.addEventListener('click', () => {
        document.getElementById('themeHex').focus();
    });

    // toolbar buttons
    document.getElementById('toggleAllBtn')?.addEventListener('click', toggleAllAccordions);
    document.getElementById('addItemBtn')?.addEventListener('click', () => { saveSnapshot(); addItemRow(); });
    document.getElementById('addSectionBtn')?.addEventListener('click', () => { saveSnapshot(); addSectionTitle(); });
    document.getElementById('addBreakBtn')?.addEventListener('click', () => { saveSnapshot(); addPageBreak(); });

    // download / project buttons
    document.getElementById('downloadSelectedBtn')?.addEventListener('click', downloadSelectedImages);
    document.getElementById('downloadBtn')?.addEventListener('click', downloadAllImages);
    document.getElementById('saveProjectBtn')?.addEventListener('click', saveProject);
    document.getElementById('loadProjectBtn')?.addEventListener('click', () => document.getElementById('projectInput').click());
    document.getElementById('projectInput')?.addEventListener('change', loadProject);

    // remote floating buttons
    document.getElementById('remoteUndo')?.addEventListener('click', undo);
    document.getElementById('remoteRedo')?.addEventListener('click', redo);
    document.getElementById('remoteDlSelectedBtn')?.addEventListener('click', downloadSelectedImages);
    document.getElementById('remoteDlAllBtn')?.addEventListener('click', downloadAllImages);
    document.getElementById('remoteSaveBtn')?.addEventListener('click', saveProject);
    document.getElementById('remoteLoadBtn')?.addEventListener('click', () => document.getElementById('projectInput').click());
    document.getElementById('remoteScrollTopBtn')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.getElementById('remoteScrollBotBtn')?.addEventListener('click', () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
    document.getElementById('remoteHelpBtn')?.addEventListener('click', openShortcutModal);

    // shortcut modal
    document.getElementById('shortcutModalOverlay')?.addEventListener('click', closeShortcutModal);
    document.getElementById('shortcutModal')?.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('modalCloseBtn')?.addEventListener('click', closeShortcutModal);

    // #20: 서식 도움말 팝업 위치 감지 — 뷰포트 상단에 가려지면 아래 방향으로 전환
    document.addEventListener('mouseenter', (e) => {
        const icon = e.target.closest?.('.fmt-help-icon');
        if (!icon) return;
        const popup = icon.querySelector('.fmt-help-popup');
        const popupHeight = popup ? popup.offsetHeight || 130 : 130;
        icon.classList.toggle('fmt-flip-below', icon.getBoundingClientRect().top < popupHeight + 16);
    }, true);
    document.addEventListener('focusin', (e) => {
        const icon = e.target.closest?.('.fmt-help-icon');
        if (!icon) return;
        const popup = icon.querySelector('.fmt-help-popup');
        const popupHeight = popup ? popup.offsetHeight || 130 : 130;
        icon.classList.toggle('fmt-flip-below', icon.getBoundingClientRect().top < popupHeight + 16);
    });
}
