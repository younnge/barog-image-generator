/* ============================================================
 * 전역 상태
 * ============================================================ */
let generatedImagesUrls = [];
let sectionPreviewRects = [];   // 렌더된 각 섹션의 미리보기 내 위치(비율) — 북마크 클릭 시 이동·하이라이트용
let cachedBgImg = null;
let bgFileName = '';   // 배경 이미지 파일명 — 저장/복원 시 드롭존 라벨을 원래대로 되돌리기 위해 보관
let cachedLogoImg = null;   // 상단 로고(병원 로고 등) — 넣으면 제목·기간이 그만큼 아래로 내려간다
let logoFileName = '';
let logoSizePct = 100;        // 로고 크기(%) 50~150, 5 단위
let logoTopPad = 26;          // 페이지 상단 ~ 로고 여백(px) — 키우면 로고와 제목이 함께 내려간다
let isBackedUp = true;
let activeColumnTab = 'left';
let layoutBalanced = false;   // '좌우 균등 맞춤' 버튼 상태 (켜면 높이 균형 배분 + 간격 균등 분배)
let balanceBottomExact = false;  // 균등 맞춤 시 두 컬럼 하단을 bottomY에 정확히 일치(A토글) — 기본 OFF
let boxCornerStyle = 'round';    // 이벤트 박스 모서리: 'sharp'(뾰족) | 'soft'(살짝) | 'round'(둥글게)
let itemDividerStyle = 'solid';  // 항목 구분선: 'none' | 'dotted' | 'dashed' | 'solid'
let docLang = 'ko';              // 문서 언어(폰트 우선순위) — 입력 문구에서 자동 판별. detectDocLang 참고
// 슬라이더로 직접 설정한 전체 텍스트 크기(%). '한 장에 자동 맞춤'을 없앤 뒤로 읽는 곳이 없어
// 실제 렌더에는 영향을 주지 않지만, 기존 백업 파일이 이 필드를 담고 있어 스키마 호환을 위해 남긴다.
let manualTextScale = 100;
let balanceSnapshot = null;   // 균등 맞춤 켜기 직전 상태(DOM 순서·텍스트 크기) — 끌 때 원상복구용
let balanceAutoBreak = null;  // 균등 맞춤 켤 때 자동 생성한 컬럼 구분선(끌 때 이 노드만 제거)
let balanceStale = false;     // 균등 맞춤 켠 뒤 내용이 바뀌어 재정렬이 필요한 상태
let gapLinked = true;         // 좌·우 섹션 간격을 같은 값으로 묶음 — 끄면 우측을 따로 조절
let undoHistory = [];
let redoHistory = [];
const MAX_UNDO = 100;
const SS_KEY = 'a4EventData';
const SS_BG_KEY = 'a4BgImage';
const SS_BG_NAME_KEY = 'a4BgName';
const SS_LOGO_KEY = 'a4LogoImage';
const SS_LOGO_NAME_KEY = 'a4LogoName';
const BG_LABEL_DEFAULT = '파일 선택 또는 드래그 (선택사항)';   // 배경 없을 때 드롭존 기본 문구
const MAX_BG_NAME_LEN = 120;   // 복원한 파일명 표시 길이 상한(비정상 파일이 레이아웃을 깨뜨리지 않게)
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;   // 배경·로고 업로드 크기 상한
const LOGO_SCALE_MIN = 50, LOGO_SCALE_MAX = 150, LOGO_SCALE_DEFAULT = 100;
const LOGO_TOP_MIN = 0, LOGO_TOP_MAX = 250, LOGO_TOP_DEFAULT = 26;   // 페이지 상단 ~ 로고(px)
const SCHEMA_VERSION = 1;   // 저장 스키마 버전 — 향후 구조 변경 시 마이그레이션 분기 기준
const MAX_RESTORE_ITEMS = 2000;   // 백업 복원 시 항목 수 상한(손상/악성 파일 DoS 방지)

/* ============================================================
 * 전역 오류 감시
 * ============================================================ */
/* 렌더 경로는 자체 try/catch 로 사용자에게 오류를 알리지만, 그 밖에서 난 예외는
 * 지금까지 조용히 사라져 사용자도 개발자도 인지할 수 없었다.
 * 백엔드가 없어 원격 수집은 불가하므로 (1) 콘솔에 상세를 남기고 (2) 사용자에게 알린다.
 * 같은 오류가 반복될 때 토스트가 도배되지 않도록 오류 종류별로 한 번만 알린다. */
const _reportedErrors = new Set();
const MAX_REPORTED_ERRORS = 50;   // 서로 다른 오류가 계속 생겨도 무한히 쌓이지 않게
function reportRuntimeError(kind, detail, raw) {
    console.error(`[${kind}] ${detail}`, raw ?? '');
    const key = `${kind}|${detail}`;
    if (_reportedErrors.has(key)) return;      // 같은 오류 반복 → 토스트는 첫 회만
    if (_reportedErrors.size >= MAX_REPORTED_ERRORS) _reportedErrors.clear();
    _reportedErrors.add(key);
    showColorToast('예기치 못한 오류가 발생했습니다. 문제가 계속되면 새로고침해 주세요.');
}
window.addEventListener('error', e => {
    // 이미지·스크립트 로드 실패는 각 onerror 에서 안내하므로 여기서는 제외(target 이 요소면 리소스 오류)
    if (e.target && e.target !== window) return;
    reportRuntimeError('실행 오류', `${e.message} @ ${e.filename || '?'}:${e.lineno || 0}`, e.error);
});
window.addEventListener('unhandledrejection', e => {
    reportRuntimeError('처리되지 않은 오류', String(e.reason?.message || e.reason), e.reason);
});

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
    tooltip._owner = el;   // 스크롤 해제 시 주인을 되찾기 위해
    document.body.appendChild(tooltip);
    el._violTooltip = tooltip;
    const eRect = el.getBoundingClientRect();
    tooltip.style.top = (eRect.bottom + 4) + 'px';
    tooltip.style.left = eRect.left + 'px';
}

/* 열려 있는 위반 툴팁을 모두 닫는다.
 * 툴팁은 body 에 붙는 position:fixed 라 위치를 띄울 때 한 번만 계산한다.
 * 입력칸이 든 패널이 스크롤되면 툴팁만 제자리에 남아 엉뚱한 곳을 가리키므로,
 * 스크롤이 일어나면 닫아서 다음 상호작용 때 올바른 위치로 다시 뜨게 한다. */
function dismissViolationTooltips() {
    document.querySelectorAll('.violation-tooltip').forEach(t => {
        const owner = t._owner;
        if (owner) {
            clearTimeout(owner._tipTimer);
            owner._violTooltip = null;
            owner.removeAttribute('data-last-violation');   // 지워야 다시 띄울 수 있다
        }
        t.remove();
    });
}

/* 의료법 검사를 붙일 입력칸 — 항목 영역 밖(제목·기간·기간 우측)은 이벤트 위임이 닿지 않아
 * 개별로 배선한다. 전단지에서 가장 크게 인쇄되는 문구들이라 검사에서 빠지면 안 된다. */
function wireViolationCheck(el) {
    if (!el) return;
    el.addEventListener('input', () => updateViolationUI(el));
    el.addEventListener('focus', () => updateViolationUI(el));
    el.addEventListener('paste', () => setTimeout(() => updateViolationUI(el), 0));   // 붙여넣기 반영 후 검사
    updateViolationUI(el);   // 저장된 내용이 이미 들어있는 경우를 위해 초기 1회
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
                cols: parseInt(child.dataset.cols, 10) || 1,
                priceLayout: child.dataset.priceLayout || '',
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
        version: SCHEMA_VERSION,
        topText: document.getElementById('topText')?.value || '',
        periodText: document.getElementById('periodText')?.value || '',
        periodNote: document.getElementById('periodNote')?.value || '',
        textColor: document.getElementById('textColorHex')?.value || '#000000',
        themeColor: document.getElementById('themeHex')?.value || '#000000',
        numColor: document.getElementById('numColorHex')?.value || '#000000',
        hlColor: document.getElementById('hlColorHex')?.value || '#FFEB3B',
        itemHlColor: document.getElementById('itemHlColorHex')?.value || '#FF0000',
        labelBoxColor: document.getElementById('labelBoxColorHex')?.value || '#000000',
        headerHeight: document.getElementById('headerHeight')?.value || '5',
        logoScale: logoSizePct,   // 백업 키는 슬라이더 이름과 동일하게
        logoTop: logoTopPad,
        textScale: document.getElementById('textScale')?.value || '100',
        sectionGap: document.getElementById('sectionGap')?.value || '15',
        sectionGapRight: document.getElementById('sectionGapRight')?.value || '15',
        balanced: layoutBalanced,
        bottomExact: balanceBottomExact,
        gapLinked: gapLinked,
        boxCorner: boxCornerStyle,
        itemDivider: itemDividerStyle,
        manualTextScale: manualTextScale,
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
    // 형태 검증: 객체이고 items가 배열이어야 부분 적용 후 실패를 방지
    if (!data || typeof data !== 'object' || (data.items !== undefined && !Array.isArray(data.items))) {
        throw new Error('잘못된 데이터 형식');
    }
    layoutBalanced = !!data.balanced;
    // 복원은 새 기준선 — 이전 DOM을 가리키던 균등 맞춤 상태는 모두 초기화
    balanceSnapshot = null; balanceAutoBreak = null; balanceStale = false;
    if (data.bottomExact !== undefined) balanceBottomExact = !!data.bottomExact;
    // 좌·우 간격 묶기(없던 기존 저장본은 두 값이 같을 때만 묶인 것으로 본다)
    gapLinked = data.gapLinked !== undefined
        ? !!data.gapLinked
        : (data.sectionGapRight === undefined || data.sectionGapRight === data.sectionGap);
    // 박스 모서리·항목 구분선(없던 기존 저장본은 기본값 유지).
    // 문서 언어는 복원하지 않는다 — 항목을 다 채운 뒤 렌더 직전에 문구로 자동 판별한다.
    if (BOX_CORNER_RADIUS[data.boxCorner] !== undefined) boxCornerStyle = data.boxCorner;
    if (ITEM_DIVIDER_DASH[data.itemDivider] !== undefined) itemDividerStyle = data.itemDivider;
    syncOptSegUI();
    // 사용자 수동 텍스트 크기 복원(없으면 저장된 슬라이더 값으로 폴백)
    manualTextScale = (data.manualTextScale !== undefined ? parseInt(data.manualTextScale) : parseInt(data.textScale)) || 100;
    updateBalanceBtn();
    if (data.topText !== undefined) { const el = document.getElementById('topText'); el.value = data.topText; autoResizeTextarea(el); }
    if (data.periodText !== undefined) document.getElementById('periodText').value = data.periodText;
    if (data.periodNote !== undefined) document.getElementById('periodNote').value = data.periodNote;
    // 헤더 3칸은 항목 영역과 달리 노드가 살아있는 채 값만 바뀐다.
    // 다시 검사하지 않으면 이전 값의 경고 표시·툴팁이 그대로 남는다(되돌리기 후 유령 경고).
    ['topText', 'periodText', 'periodNote'].forEach(id => {
        const el = document.getElementById(id);
        if (el) updateViolationUI(el);
    });
    if (data.textColor) updateTextColorSync(data.textColor);
    if (data.themeColor) updateColorSync(data.themeColor);
    if (data.numColor) updateNumColorSync(data.numColor);
    if (data.hlColor) updateHlColorSync(data.hlColor);
    // 항목 강조 색상: 없던 기존 저장본은 예전 동작(테마색)으로 폴백
    updateItemHlColorSync(data.itemHlColor || data.themeColor || '#000000');
    if (data.labelBoxColor) updateLabelBoxColorSync(data.labelBoxColor);
    if (data.headerHeight !== undefined) {
        const sl = document.getElementById('headerHeight');
        sl.value = data.headerHeight;
        updateSliderBg(sl);
        document.getElementById('headerHeightLabel').value = data.headerHeight;
    }
    {   // 로고 크기·세로 위치(없던 기존 저장본은 기본값)
        const clamp = (raw, min, max, def) => {
            const v = parseInt(raw, 10);
            return Number.isFinite(v) ? Math.min(Math.max(v, min), max) : def;
        };
        logoSizePct = clamp(data.logoScale, LOGO_SCALE_MIN, LOGO_SCALE_MAX, LOGO_SCALE_DEFAULT);
        logoTopPad = clamp(data.logoTop, LOGO_TOP_MIN, LOGO_TOP_MAX, LOGO_TOP_DEFAULT);
        syncLogoScaleUI();
    }
    if (data.textScale !== undefined) {
        const sl = document.getElementById('textScale');
        if (sl) {
            sl.value = data.textScale;
            updateSliderBg(sl);
            document.getElementById('textScaleLabel').value = data.textScale;
        }
    }
    if (data.sectionGap !== undefined) {
        const sl = document.getElementById('sectionGap');
        if (sl) {
            sl.value = data.sectionGap;
            updateSliderBg(sl);
            document.getElementById('sectionGapLabel').value = data.sectionGap;
        }
    }
    {   // 오른쪽 컬럼 간격 복원(없던 기존 저장본은 왼쪽 값으로 폴백)
        const sr = document.getElementById('sectionGapRight');
        if (sr) {
            const rv = data.sectionGapRight !== undefined ? data.sectionGapRight : (data.sectionGap !== undefined ? data.sectionGap : '15');
            sr.value = rv;
            updateSliderBg(sr);
            const rl = document.getElementById('sectionGapRightLabel'); if (rl) rl.value = rv;
        }
    }
    const container = document.getElementById('itemsContainer');
    // innerHTML 교체 전 남아있는 위반 툴팁을 body에서 제거
    container.querySelectorAll('.btn-input').forEach(el => { el._violTooltip?.remove(); el._violTooltip = null; });
    container.innerHTML = '';
    let items = data.items || [];
    // 과도한 항목 수 가드: 비정상/손상 백업이 수만 개 노드를 동기 생성해 탭이 멈추는 것을 방지
    if (items.length > MAX_RESTORE_ITEMS) {
        items = items.slice(0, MAX_RESTORE_ITEMS);
        showColorToast(`항목이 너무 많아 앞 ${MAX_RESTORE_ITEMS}개만 불러왔습니다.`);
    }
    items.forEach(item => {
        if (item.type === 'item') addItemRow(item);
        else if (item.type === 'sectionTitle') addSectionTitle(item.value, item.collapsed, item.id, item.titleSize || 24, item.bodySize || 20, item.numSize || 35, !!item.isFullWidth);
        else if (item.type === 'columnBreak') addColumnBreak(item.id);
    });
    document.querySelectorAll('.item-name, .section-title-input').forEach(el => updateViolationUI(el));
    refreshAccordionVisibility();
    updateRemoteState();
    applyColumnTabFilter();
}

function undo() {
    if (undoHistory.length === 0) return;
    redoHistory.push(JSON.stringify(getSnapshot()));
    restoreSnapshot(undoHistory.pop());
    renderImagesNow();   // 되돌리기는 즉시 반영(디바운스 없이)
    updateRemoteState();
}
function redo() {
    if (redoHistory.length === 0) return;
    undoHistory.push(JSON.stringify(getSnapshot()));
    restoreSnapshot(redoHistory.pop());
    renderImagesNow();   // 다시실행도 즉시 반영
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

function applyColumnTabFilter() {
    const container = document.getElementById('itemsContainer');
    if (!container) return;
    const children = Array.from(container.children);
    const breakIdx = children.findIndex(n => n.classList.contains('column-break-wrapper'));

    children.forEach((child, i) => {
        if (child.classList.contains('column-break-wrapper')) {
            child.style.display = activeColumnTab === 'all' ? '' : 'none';
            return;
        }
        const isFull = child.dataset.fullWidth === 'true';
        let show = true;
        if (activeColumnTab === 'left') {
            // 전체폭 섹션은 위치와 무관하게 항상 좌측 탭에서 편집
            show = isFull || breakIdx === -1 || i < breakIdx;
        } else if (activeColumnTab === 'right') {
            // 전체폭 섹션은 우측 탭에서 숨김(좌측 탭 전용)
            show = !isFull && breakIdx !== -1 && i > breakIdx;
        }
        child.style.display = show ? '' : 'none';
    });

    // 우측 탭에서 숨겨진 전체폭 섹션이 있으면 안내 배너 표시
    const fwHint = document.getElementById('fullWidthHint');
    if (fwHint) {
        const hasFull = children.some(n => n.dataset.fullWidth === 'true');
        fwHint.style.display = (activeColumnTab === 'right' && hasFull) ? '' : 'none';
    }

    document.querySelectorAll('.col-tab').forEach(btn => {
        const on = btn.dataset.col === activeColumnTab;
        btn.classList.toggle('col-tab-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const colBtn = document.getElementById('addColumnBreakBtn');
    if (colBtn) colBtn.style.display = activeColumnTab === 'all' ? '' : 'none';

    resizeVisibleTextareas();   // 새로 보이게 된 컬럼의 입력칸 높이 재계산
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
    persistSessionImage('bg', cachedBgImg, SS_BG_KEY, SS_BG_NAME_KEY, bgFileName, '배경');
    persistSessionImage('logo', cachedLogoImg, SS_LOGO_KEY, SS_LOGO_NAME_KEY, logoFileName, '로고');
}

/* 세션에 마지막으로 쓰려고 시도한 이미지 — 같은 이미지를 편집마다 다시 쓰지 않기 위한 기록.
 * 이전에는 스냅샷마다(타이핑 멈출 때마다) 수 MB 데이터URL 을 무조건 재직렬화했고,
 * 용량을 넘으면 그때마다 예외가 나 같은 토스트가 반복됐다. */
const _ssImageWritten = { bg: null, logo: null };
function persistSessionImage(kind, img, srcKey, nameKey, fileName, label) {
    const src = img?.src?.startsWith('data:') ? img.src : null;
    if (!src) { _ssImageWritten[kind] = null; return; }
    if (_ssImageWritten[kind] === src) return;   // 같은 이미지 — 이미 처리했다
    // 성공·실패 모두 기록한다. 실패한 이미지를 매번 다시 시도하면 토스트가 도배된다.
    _ssImageWritten[kind] = src;
    try {
        sessionStorage.setItem(srcKey, src);
        sessionStorage.setItem(nameKey, fileName);
    } catch(e) {
        // 새로고침하면 사라진다는 사실과 대처법을 함께 알린다(용량 초과는 사용자가 손쓸 수 없음)
        showColorToast(`${label} 이미지가 커서 새로고침하면 사라집니다 — 저장 버튼으로 백업해 두세요`);
    }
}
/* 배경을 지웠을 때 세션에 남은 배경까지 비운다(새로고침 시 지운 배경이 되살아나지 않게). */
function clearSessionBg() {
    _ssImageWritten.bg = null;   // 같은 이미지를 다시 넣었을 때 저장이 건너뛰어지지 않도록
    try { sessionStorage.removeItem(SS_BG_KEY); sessionStorage.removeItem(SS_BG_NAME_KEY); } catch(e) {}
}
function clearSessionLogo() {
    _ssImageWritten.logo = null;
    try { sessionStorage.removeItem(SS_LOGO_KEY); sessionStorage.removeItem(SS_LOGO_NAME_KEY); } catch(e) {}
}
/* 배경을 완전히 제거 — 캔버스용 이미지·드롭존 표시·세션 저장본·파일 입력값까지 한 번에.
 * 파일 입력값을 비워야 같은 파일을 다시 골랐을 때도 change 이벤트가 발생한다. */
function clearBackground() {
    cachedBgImg = null;
    hideBgThumb();
    clearSessionBg();
    const input = document.getElementById('bgInput');
    if (input) input.value = '';
}
/* 로고 제거 — 배경과 같은 규칙(크기 값은 유지해 다시 넣었을 때 그대로 쓰이게). */
function clearLogo() {
    cachedLogoImg = null;
    hideLogoThumb();
    clearSessionLogo();
    const input = document.getElementById('logoInput');
    if (input) input.value = '';
}
function restoreFromSessionStorage() {
    try {
        const saved = sessionStorage.getItem(SS_KEY);
        if (!saved) return false;
        restoreSnapshot(JSON.parse(saved));
        // 세션에서 되살린 이미지는 이미 세션에 있으므로 '쓴 것'으로 표시해 재기록을 건너뛴다
        const bgData = sessionStorage.getItem(SS_BG_KEY);
        if (bgData) {
            const bgName = sessionStorage.getItem(SS_BG_NAME_KEY) || '';
            const img = new Image();
            img.onload = () => { cachedBgImg = img; _ssImageWritten.bg = bgData; showBgThumb(bgData, bgName); generateImages(); };
            img.onerror = () => { clearBackground(); generateImages(); };   // 손상된 저장 배경은 조용히 제거
            img.src = bgData;
        }
        const logoData = sessionStorage.getItem(SS_LOGO_KEY);
        if (logoData) {
            const logoName = sessionStorage.getItem(SS_LOGO_NAME_KEY) || '';
            const img = new Image();
            img.onload = () => { cachedLogoImg = img; _ssImageWritten.logo = logoData; showLogoThumb(logoData, logoName); generateImages(); };
            img.onerror = () => { clearLogo(); generateImages(); };
            img.src = logoData;
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
/* 항목 가로 칸 세그먼트 아이콘 — 칸이 n개로 나뉜 모습(세로 칸 1·2·3개)을 그려 직관적으로 표시 */
function colSegIcon(n) {
    const rects = {
        1: '<rect x=".5" y=".5" width="14" height="10" rx="1.5"/>',
        2: '<rect x=".5" y=".5" width="6.5" height="10" rx="1.5"/><rect x="8" y=".5" width="6.5" height="10" rx="1.5"/>',
        3: '<rect x=".5" y=".5" width="4" height="10" rx="1.5"/><rect x="5.5" y=".5" width="4" height="10" rx="1.5"/><rect x="10.5" y=".5" width="4" height="10" rx="1.5"/>'
    }[n];
    return `<svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

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
                    </div>
                </div>
            </div>
            <div style="display:flex;gap:4px;align-self:flex-end;margin-bottom:2px;">
                <button class="btn-copy btn-opts-settings js-toggle-sec-opts" title="옵션" aria-label="섹션 옵션">${OPTS_SVG}</button>
                <button class="btn-copy js-dup-section" title="복제" aria-label="섹션 복제">${COPY_SVG}</button>
                <button class="btn-remove js-del-section" title="삭제" aria-label="섹션 삭제">${CLOSE_SVG}</button>
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
    return wrapper;
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
    div.innerHTML = `<input type="text" class="btn-input price-label-input price-label-${n}" placeholder="단위" value="${escapeHtml(label)}"><input type="text" class="btn-input price-val-input price-val-${n}" placeholder="금액" value="${escapeHtml(val)}"><button class="btn-dup-price-slot js-dup-price-slot" title="슬롯 복제" aria-label="가격 슬롯 복제">${COPY_SVG}</button><button class="btn-remove-price-slot js-remove-price-slot" title="슬롯 삭제" aria-label="가격 슬롯 삭제">−</button>`;
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
    const cols = [2, 3].includes(parseInt(itemData.cols, 10)) ? parseInt(itemData.cols, 10) : 1;
    const pl = itemData.priceLayout === 'stack' ? 'stack' : 'side';   // 기본값 나란히(side)
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
            <button class="btn-copy js-dup-item" title="복제" aria-label="항목 복제">${COPY_SVG}</button>
            <button class="btn-remove js-del-item" title="삭제" aria-label="항목 삭제">${CLOSE_SVG}</button>
        </div>
        <div class="item-row-controls">
            <div class="item-cols-seg" title="이 항목이 섹션 안에서 차지하는 가로 칸 (같은 칸끼리 한 줄에 모임)">
                <button class="item-col-btn js-itemcol${cols === 1 ? ' item-col-active' : ''}" data-cols="1" title="전체폭">${colSegIcon(1)}</button>
                <button class="item-col-btn js-itemcol${cols === 2 ? ' item-col-active' : ''}" data-cols="2" title="2열">${colSegIcon(2)}</button>
                <button class="item-col-btn js-itemcol${cols === 3 ? ' item-col-active' : ''}" data-cols="3" title="3열">${colSegIcon(3)}</button>
            </div>
            <div class="item-cols-seg item-pl-seg" title="가격 배치: 나란히(이름 옆 한 줄) / 아래로(이름 아래)">
                <button class="item-col-btn js-itempl${pl === 'side' ? ' item-col-active' : ''}" data-pl="side" title="가격을 이름 옆에 나란히">↔</button>
                <button class="item-col-btn js-itempl${pl === 'stack' ? ' item-col-active' : ''}" data-pl="stack" title="가격을 이름 아래로">↧</button>
            </div>
            <input type="checkbox" class="item-sublabel" style="display:none" ${isSublabel ? 'checked' : ''}>
            <button class="btn-action-text js-toggle-sublabel${isSublabel ? ' btn-action-active' : ''}" title="소제목 행으로 표시 (가격 없이 강조 행)">소제목</button>
            <button class="btn-action-text js-toggle-note${note ? ' btn-action-active' : ''}" title="비고 텍스트 추가">비고</button>
        </div>
        <div class="item-prices-row${isSublabel ? ' hidden' : ''}">
            <div class="price-slots-wrap"></div>
            <button class="btn-add-price-slot js-add-price-slot" title="가격 슬롯 추가" aria-label="가격 슬롯 추가">+</button>
        </div>
        <div class="item-note-row${note ? '' : ' hidden'}">
            <div class="item-name-wrapper">
                <textarea class="btn-input item-note-input auto-resize" placeholder="※ 비고 (작은글씨 / Enter 줄바꿈)" rows="1">${escapeHtml(note)}</textarea>
                <div class="format-toolbar">
                    <button class="fmt-btn fmt-color" data-open="&lt;" data-close="&gt;" title="강조색 적용">강조</button>
                    <button class="fmt-btn fmt-up" data-open="&lt;+" data-close="+&gt;" title="글자 확대">확대</button>
                    <button class="fmt-btn fmt-dn" data-open="&lt;-" data-close="-&gt;" title="글자 축소">축소</button>
                    <button class="fmt-btn fmt-bold" data-open="{" data-close="}" title="굵게">굵게</button>
                </div>
            </div>
        </div>
    `;
    row.dataset.cols = String(cols);
    row.dataset.priceLayout = pl;
    const slotsWrap = row.querySelector('.price-slots-wrap');
    prices.forEach((p, i) => slotsWrap.appendChild(buildPriceSlotEl(i + 1, p.label, p.val)));
    renumberPriceSlots(row);

    container.appendChild(row);
    row.querySelector('.js-toggle-sublabel').addEventListener('click', function() {
        const checkbox = row.querySelector('.item-sublabel');
        checkbox.checked = !checkbox.checked;
        this.classList.toggle('btn-action-active', checkbox.checked);
        row.querySelector('.item-prices-row').classList.toggle('hidden', checkbox.checked);
        markBalanceStale();
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    initDragAndDrop(row);
    setTimeout(() => {
        const ta = row.querySelector('.item-name'); if (ta) autoResizeTextarea(ta);
        const nt = row.querySelector('.item-note-input'); if (nt && nt.value) autoResizeTextarea(nt);
    }, 0);
    refreshAccordionVisibility();
    debouncedGenerateImages();
    return row;
}

/* 컬럼 구분 노드 생성(삽입 위치는 호출부에서 결정) */
function createColumnBreakNode(undoId = null) {
    const wrapper = document.createElement('div');
    wrapper.className = 'column-break-wrapper';
    wrapper.setAttribute('data-undo-id', sanitizeId(undoId) || generateUniqueId('col'));
    wrapper.innerHTML = `
        <div class="drag-handle">${DRAG_SVG}</div>
        <div class="column-break-line">↔ 여기서 오른쪽 컬럼으로 분리 ↔</div>
        <button class="btn-remove js-del-colbreak" title="삭제" aria-label="컬럼 구분 삭제">${CLOSE_SVG}</button>
    `;
    initDragAndDrop(wrapper);
    return wrapper;
}
function addColumnBreak(undoId = null) {
    const container = document.getElementById('itemsContainer');
    container.appendChild(createColumnBreakNode(undoId));
    refreshAccordionVisibility();
    debouncedGenerateImages();
}


function autoResizeTextarea(el) {
    el.style.height = '1px';
    const sh = el.scrollHeight;
    const max = parseFloat(getComputedStyle(el).maxHeight);   // CSS max-height (px) 또는 NaN(none)
    if (!isNaN(max) && sh > max) {
        el.style.height = max + 'px';
        el.style.overflowY = 'auto';     // 최대 높이 초과 → 내부 스크롤
    } else {
        el.style.height = Math.max(32, sh) + 'px';
        el.style.overflowY = 'hidden';
    }
}

/* 보이는 항목명/섹션제목 textarea 를 내용 높이에 맞춰 재확장.
 * 숨김(display:none) 상태에선 scrollHeight 가 부정확하므로, 탭/컬럼 전환 등으로
 * 다시 보이게 될 때 호출해 잘림(1줄 고정)을 방지. */
function resizeVisibleTextareas() {
    document.querySelectorAll('#itemsContainer .item-name, #itemsContainer .section-title-input').forEach(ta => {
        if (ta.offsetParent !== null) autoResizeTextarea(ta);
    });
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

    function makeEntry(node, side) {
        const title = plainTextFromStyled(node.querySelector('.section-title-input')?.value || '').trim() || '(제목 없음)';
        const entry = document.createElement('div');
        const isActive = !node.classList.contains('collapsed');
        entry.className = 'bm-entry bm-section' + (isActive ? ' bm-active' : '');
        entry.textContent = title;
        entry._sectionNode = node;   // 대응하는 섹션 헤더 DOM
        entry._side = side;
        entry.addEventListener('mousedown', onBmDragStart);
        entry.addEventListener('touchstart', onBmDragStart, { passive: false });
        entry.addEventListener('click', e => {
            if (bmSuppressClick) { bmSuppressClick = false; return; }   // 드래그 직후 클릭 무시
            if (side && side !== activeColumnTab) {
                activeColumnTab = side;
                applyColumnTabFilter();
            }
            document.querySelectorAll('#itemsContainer .section-title-wrapper').forEach(s => {
                s.classList.toggle('collapsed', s !== node);
            });
            refreshAccordionVisibility();
            refreshBookmarks();
            scrollToItem(node);
            highlightPreviewSection(node);
        });
        return entry;
    }

    if (hasColBreak) {
        list.classList.add('bm-two-col');
        const leftCol = document.createElement('div');
        leftCol.className = 'bm-col';
        const rightCol = document.createElement('div');
        rightCol.className = 'bm-col';
        // 전체폭 섹션은 컬럼에 넣지 않고 전체 너비로(좌측 탭 전용). 미리보기와 동일하게
        // 컬럼 내용 앞에 나온 전체폭은 상단, 뒤에 나온 전체폭은 하단에 배치.
        const leadFull = [], trailFull = [];
        let seenCol = false;
        let currentCol = leftCol;
        let currentSide = 'left';
        children.forEach(node => {
            if (node.classList.contains('column-break-wrapper')) {
                currentCol = rightCol;
                currentSide = 'right';
            } else if (node.classList.contains('section-title-wrapper')) {
                if (node.dataset.fullWidth === 'true') {
                    const en = makeEntry(node, 'left');
                    en.classList.add('bm-full');
                    (seenCol ? trailFull : leadFull).push(en);
                } else {
                    seenCol = true;
                    currentCol.appendChild(makeEntry(node, currentSide));
                }
            }
        });
        leadFull.forEach(en => list.appendChild(en));    // 컬럼 내용 위(상단)
        list.appendChild(leftCol);
        list.appendChild(rightCol);
        trailFull.forEach(en => list.appendChild(en));   // 컬럼 내용 아래(하단)
    } else {
        list.classList.remove('bm-two-col');
        children.forEach(node => {
            if (node.classList.contains('section-title-wrapper')) {
                list.appendChild(makeEntry(node, 'left'));
            }
        });
    }
}

/* ===== 북마크 드래그로 이벤트(섹션) 순서 변경 — 상하(같은 컬럼)·좌우(컬럼 간) ===== */
let bmDragSrc = null, bmDragMoved = false, bmSuppressClick = false, bmStartX = 0, bmStartY = 0;
let bmGhost = null, bmGhostDX = 0, bmGhostDY = 0;   // 마우스를 따라오는 드래그 미리보기

/* 드래그 중인 항목을 복제해 커서를 따라다니는 고스트 생성(시각적 피드백) */
function createBmGhost(src, p) {
    const r = src.getBoundingClientRect();
    bmGhostDX = p.clientX - r.left;
    bmGhostDY = p.clientY - r.top;
    bmGhost = src.cloneNode(true);
    bmGhost.className = 'bm-entry bm-ghost';
    bmGhost.style.width = r.width + 'px';
    bmGhost.style.left = r.left + 'px';
    bmGhost.style.top = r.top + 'px';
    document.body.appendChild(bmGhost);
}

function onBmDragStart(e) {
    bmDragSrc = e.currentTarget;
    bmDragMoved = false;
    bmSuppressClick = false;   // 새 상호작용 — 이전 드래그의 잔여 플래그 제거
    const p = e.touches ? e.touches[0] : e;
    bmStartX = p.clientX; bmStartY = p.clientY;
    if (e.touches) {
        document.addEventListener('touchmove', onBmDragMove, { passive: false });
        document.addEventListener('touchend', onBmDragEnd);
    } else {
        document.addEventListener('mousemove', onBmDragMove);
        document.addEventListener('mouseup', onBmDragEnd);
    }
}

function onBmDragMove(e) {
    if (!bmDragSrc) return;
    const p = e.touches ? e.touches[0] : e;
    if (!bmDragMoved) {
        if (Math.hypot(p.clientX - bmStartX, p.clientY - bmStartY) < 5) return;  // 임계값: 클릭과 구분
        bmDragMoved = true;
        bmDragSrc.classList.add('bm-dragging');
        createBmGhost(bmDragSrc, p);   // 커서 추종 미리보기 시작
    }
    if (e.cancelable) e.preventDefault();

    if (bmGhost) {   // 고스트를 커서 위치로 이동
        bmGhost.style.left = (p.clientX - bmGhostDX) + 'px';
        bmGhost.style.top = (p.clientY - bmGhostDY) + 'px';
    }

    const list = document.getElementById('bookmarkList');
    const isFull = bmDragSrc.classList.contains('bm-full');
    // 대상 컬럼 결정 (2열이면 X로, 아니면 단일 리스트). 전체폭 항목은 상단 전체폭 영역에서만 이동.
    let targetCol = list;
    if (list.classList.contains('bm-two-col') && !isFull) {
        const cols = Array.from(list.querySelectorAll('.bm-col'));
        targetCol = cols.reduce((best, col) => {
            const r = col.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const d = Math.abs(p.clientX - cx);
            return (!best || d < best.d) ? { col, d } : best;
        }, null).col;
    }
    // 삽입 후보: 전체폭 항목은 다른 전체폭 항목끼리만, 일반 항목은 같은 컬럼 내에서만
    const entries = isFull
        ? Array.from(list.children).filter(en => en.classList.contains('bm-full') && en !== bmDragSrc)
        : Array.from(targetCol.querySelectorAll('.bm-entry')).filter(en => en !== bmDragSrc);
    let before = null;
    for (const en of entries) {
        const r = en.getBoundingClientRect();
        if (p.clientY < r.top + r.height / 2) { before = en; break; }
    }
    if (isFull) {
        // 전체폭은 컬럼 묶음을 기준으로 위(상단)·아래(하단) 모두 이동 가능
        const firstCol = list.querySelector('.bm-col');
        if (before) {
            list.insertBefore(bmDragSrc, before);
        } else if (firstCol && p.clientY < firstCol.getBoundingClientRect().top) {
            list.insertBefore(bmDragSrc, firstCol);   // 컬럼 위(상단)
        } else {
            list.appendChild(bmDragSrc);              // 컬럼 아래(하단)
        }
    } else {
        before ? targetCol.insertBefore(bmDragSrc, before) : targetCol.appendChild(bmDragSrc);
    }
}

function onBmDragEnd() {
    document.removeEventListener('mousemove', onBmDragMove);
    document.removeEventListener('mouseup', onBmDragEnd);
    document.removeEventListener('touchmove', onBmDragMove);
    document.removeEventListener('touchend', onBmDragEnd);
    const moved = bmDragMoved;
    if (bmDragSrc) bmDragSrc.classList.remove('bm-dragging');
    if (bmGhost) { bmGhost.remove(); bmGhost = null; }   // 고스트 제거
    bmDragSrc = null; bmDragMoved = false;
    if (moved) {
        bmSuppressClick = true;        // 바로 뒤따르는 click(내비게이션) 무시
        applyBookmarkOrderToDom();
    }
}

/* 북마크 패널의 현재 순서대로 itemsContainer 의 섹션 블록을 재배치.
 * 2열이면 [좌측 컬럼 순서][구분선][우측 컬럼 순서], 전체폭·헤더없는 항목은 상단 유지. */
function applyBookmarkOrderToDom() {
    const list = document.getElementById('bookmarkList');
    const container = document.getElementById('itemsContainer');
    const blocks = collectSectionBlocks();
    const blockOf = new Map(blocks.map(b => [b.wrapper, b]));
    const twoCol = list.classList.contains('bm-two-col');

    let leadFullNodes = [], trailFullNodes = [], leftNodes = [], rightNodes = [];
    if (twoCol) {
        // 전체폭 섹션은 컬럼 밖에 있음 — 컬럼(.bm-col) 기준 앞/뒤로 나눠 상·하단 위치 보존
        const firstColIdx = Array.from(list.children).findIndex(n => n.classList.contains('bm-col'));
        Array.from(list.children).forEach((n, i) => {
            if (!n.classList.contains('bm-full')) return;
            (i < firstColIdx ? leadFullNodes : trailFullNodes).push(n._sectionNode);
        });
        const cols = list.querySelectorAll('.bm-col');
        leftNodes = Array.from(cols[0]?.querySelectorAll('.bm-entry') || []).map(en => en._sectionNode);
        rightNodes = Array.from(cols[1]?.querySelectorAll('.bm-entry') || []).map(en => en._sectionNode);
    } else {
        leftNodes = Array.from(list.querySelectorAll('.bm-entry')).map(en => en._sectionNode);
    }
    const ordered = new Set([...leadFullNodes, ...trailFullNodes, ...leftNodes, ...rightNodes]);
    // 북마크에 없는 블록(헤더없는 항목 등)은 상단 유지
    const leadBlocks = blocks.filter(b => !ordered.has(b.wrapper));

    const order = [];
    const pushBlock = b => { if (!b) return; if (b.wrapper) order.push(b.wrapper); order.push(...b.items); };
    leadBlocks.forEach(pushBlock);
    leadFullNodes.forEach(n => pushBlock(blockOf.get(n)));   // 컬럼 앞(상단) 전체폭
    leftNodes.forEach(n => pushBlock(blockOf.get(n)));
    if (twoCol) {
        const breaks = Array.from(container.querySelectorAll('.column-break-wrapper'));
        breaks.slice(1).forEach(b => b.remove());
        let brk = breaks[0];
        if (!brk) { addColumnBreak(); brk = container.querySelector('.column-break-wrapper'); }
        order.push(brk);
        rightNodes.forEach(n => pushBlock(blockOf.get(n)));
    }
    trailFullNodes.forEach(n => pushBlock(blockOf.get(n)));  // 컬럼 뒤(하단) 전체폭
    order.forEach(n => container.appendChild(n));

    refreshAccordionVisibility();
    applyColumnTabFilter();
    refreshBookmarks();
    saveSnapshot();
    debouncedGenerateImages();
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

/* 북마크 클릭 시 오른쪽 미리보기에서 해당 섹션 위치로 스크롤 + 반투명 하이라이트를 잠깐 표시. */
let _previewHlTimer = null;
function highlightPreviewSection(node) {
    const container = document.getElementById('previewContainer');
    if (!container) return;
    const rect = sectionPreviewRects.find(r => r.node === node);
    if (!rect) return;   // 아직 생성 전이거나 넘쳐서 잘린 섹션
    const imgs = container.querySelectorAll('img');
    const img = imgs[rect.page];
    if (!img || !img.clientHeight) return;

    const left = img.offsetLeft + rect.fx * img.clientWidth;
    const top = img.offsetTop + rect.fy * img.clientHeight;
    const width = rect.fw * img.clientWidth;
    const height = rect.fh * img.clientHeight;

    // 하이라이트 오버레이(재사용)
    let hl = container.querySelector('.preview-highlight');
    if (!hl) {
        hl = document.createElement('div');
        hl.className = 'preview-highlight';
        container.appendChild(hl);
    }
    hl.style.left = left + 'px';
    hl.style.top = top + 'px';
    hl.style.width = width + 'px';
    hl.style.height = height + 'px';

    // 실제로 스크롤되는 조상(미리보기 컨테이너 또는 페이지)이 무엇이든 해당 위치로 이동.
    hl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    // 리플로우 강제 후 애니메이션 재시작
    hl.classList.remove('show');
    void hl.offsetWidth;
    hl.classList.add('show');
    clearTimeout(_previewHlTimer);
    _previewHlTimer = setTimeout(() => hl.classList.remove('show'), 1400);
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
let dragSrc = null, dragGroup = [];   // 제목 드래그 시 함께 움직일 하위 항목들
function initDragAndDrop(el) {
    el.addEventListener('mousedown', onDragMouseDown);
    el.addEventListener('touchstart', onDragTouchStart, { passive: false });
}
/* 제목 래퍼에 딸린 하위 항목(다음 형제 item-row들, 다음 제목·컬럼구분 전까지) 수집 */
function sectionItemsOf(titleWrapper) {
    const items = [];
    let n = titleWrapper.nextElementSibling;
    while (n && n.classList.contains('item-row')) { items.push(n); n = n.nextElementSibling; }
    return items;
}
function beginDrag(el) {
    dragSrc = el;
    dragSrc.classList.add('dragging');
    // 제목을 끌면 그 섹션 항목까지 한 덩어리로 이동(항목·컬럼구분 드래그는 단독)
    dragGroup = dragSrc.classList.contains('section-title-wrapper') ? sectionItemsOf(dragSrc) : [];
    dragGroup.forEach(it => it.classList.add('dragging'));
}
function endDrag() {
    [dragSrc, ...dragGroup].forEach(el => el && el.classList.remove('dragging'));
    dragSrc = null; dragGroup = [];
}
function onDragMouseDown(e) {
    if (!e.target.closest('.drag-handle')) return;
    e.preventDefault();
    beginDrag(this);
    document.addEventListener('mousemove', onDragMouseMove);
    document.addEventListener('mouseup', onDragMouseUp);
}
function onDragMouseMove(e) {
    if (!dragSrc) return;
    placeDraggedItem(e.clientY);
}
/* 현재 컬럼 탭(좌/우/전체) 경계를 벗어나지 않도록 드래그 위치를 계산해 배치 */
function placeDraggedItem(clientY) {
    const container = document.getElementById('itemsContainer');
    const breakEl = container.querySelector('.column-break-wrapper');
    const block = [dragSrc, ...dragGroup];            // 함께 움직일 덩어리(제목+항목)
    const blockSet = new Set(block);
    // 드래그 중인 덩어리·숨겨진 항목(다른 컬럼)은 후보에서 제외 — 보이는 항목만으로 삽입 지점 판단
    const els = Array.from(container.children).filter(c =>
        !blockSet.has(c) && !c.classList.contains('items-empty-hint') && c.style.display !== 'none');
    let insertBefore = null;
    for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) { insertBefore = el; break; }
    }
    // 맨 아래로 드롭 시: 좌측 탭에서는 컬럼 구분선 앞까지만 (우측 컬럼 침범 방지)
    if (!insertBefore && activeColumnTab === 'left' && breakEl) insertBefore = breakEl;
    // 덩어리를 순서대로 같은 기준 위치에 삽입(제목 → 항목들 순서 유지)
    block.forEach(b => insertBefore ? container.insertBefore(b, insertBefore) : container.appendChild(b));
}
function onDragMouseUp() {
    if (!dragSrc) return;
    endDrag();
    document.removeEventListener('mousemove', onDragMouseMove);
    document.removeEventListener('mouseup', onDragMouseUp);
    refreshAccordionVisibility();
    markBalanceStale();
    saveSnapshot();
    debouncedGenerateImages();
}
function onDragTouchStart(e) {
    if (!e.target.closest('.drag-handle')) return;
    e.preventDefault();
    beginDrag(this);
    document.addEventListener('touchmove', onDragTouchMove, { passive: false });
    document.addEventListener('touchend', onDragTouchEnd);
}
function onDragTouchMove(e) {
    e.preventDefault();
    if (!dragSrc) return;
    placeDraggedItem(e.touches[0].clientY);
}
function onDragTouchEnd() {
    if (!dragSrc) return;
    endDrag();
    document.removeEventListener('touchmove', onDragTouchMove);
    document.removeEventListener('touchend', onDragTouchEnd);
    refreshAccordionVisibility();
    markBalanceStale();
    saveSnapshot();
    debouncedGenerateImages();
}

/* ============================================================
 * 텍스트 서식 DSL (기존 앱과 동일: tokenize → parse → flattenAST)
 * ============================================================ */
const SIZE_STEP = 4;

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

/* 짝 없는 닫기 토큰의 원래 문자 복원(텍스트 유실 방지용). */
function closeTokenLiteral(t) {
    if (t.type === 'CLOSE_BRACE') return '}';
    const d = t.sizeDelta || 0;
    return (d > 0 ? '+'.repeat(d) : d < 0 ? '-'.repeat(-d) : '') + '>';
}

/* 짝 없는 여는 토큰의 원래 문자 복원('<', '<+', '<-', '{' 등). */
function openTokenLiteral(t) {
    if (t.type === 'OPEN_BRACE') return '{';
    const d = t.sizeDelta || 0;
    return '<' + (d > 0 ? '+'.repeat(d) : d < 0 ? '-'.repeat(-d) : '');
}

function parse(tokens) {
    let pos = 0;
    // top=true(최상위)에서는 짝 없는 닫기 토큰(>,})을 리터럴 텍스트로 흡수해 뒤 텍스트 유실을 막는다.
    // 중첩 호출(top=false)에서는 기존대로 닫기에서 break 하여 부모 여는 토큰이 소비하게 둔다.
    function parseBlock(top) {
        const nodes = [];
        while (pos < tokens.length) {
            const t = tokens[pos];
            if (t.type === 'TEXT') { nodes.push({ type: 'TEXT', value: t.value }); pos++; }
            else if (t.type === 'OPEN_ANGLE') {
                pos++; const children = parseBlock(false);
                if (pos < tokens.length && tokens[pos].type === 'CLOSE_ANGLE') {
                    const cd = tokens[pos].sizeDelta; pos++;
                    nodes.push({ type: 'ANGLE', sizeDelta: t.sizeDelta || cd, children });
                } else {
                    // 짝 없는 여는 토큰 → '<'를 리터럴로 복원하고 자식은 스타일 없이 펼침
                    nodes.push({ type: 'TEXT', value: openTokenLiteral(t) }, ...children);
                }
            } else if (t.type === 'OPEN_BRACE') {
                pos++; const children = parseBlock(false);
                if (pos < tokens.length && tokens[pos].type === 'CLOSE_BRACE') {
                    pos++;
                    nodes.push({ type: 'BRACE', children });
                } else {
                    nodes.push({ type: 'TEXT', value: openTokenLiteral(t) }, ...children);
                }
            } else if (top) {
                // 짝 없는 닫기 토큰 → 리터럴 텍스트로 처리하고 계속 파싱
                nodes.push({ type: 'TEXT', value: closeTokenLiteral(t) }); pos++;
            } else break;
        }
        return nodes;
    }
    return parseBlock(true);
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

/* 서식 DSL 기호(<>, {} 및 크기 토큰)를 제거한 순수 텍스트 — 북마크/목차 표시용 */
function plainTextFromStyled(text) {
    return parseStyledText(text).map(c => c.text).join('');
}

function getChunkFont(chunk, baseSize, isBold, fonts) {
    const size = Math.max(8, baseSize + chunk.sizeDelta * SIZE_STEP);
    const weight = chunk.boldLevel >= 2 ? 900 : chunk.boldLevel === 1 ? 800 : isBold ? 700 : 500;
    const family = isBold || chunk.boldLevel > 0 ? fonts.bold : fonts.main;
    return { font: `${weight} ${size}px ${family}`, size };
}

function wrapStyledText(ctx, text, maxWidth, baseSize, isBold, fonts) {
    text = String(text || '');
    if (!text) return [{ chunks: [], totalWidth: 0 }];
    // 청크 폭은 항상 letterSpacing 0px 로 측정해야 한다 — 실제 그리기도 0px 이므로.
    // (직전 렌더의 숫자 자간 -1.5px 등이 남아 있으면 폭이 좁게 측정돼 서식 경계에서 글자가 겹친다)
    ctx.letterSpacing = '0px';
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
                if (sub) { const w = ctx.measureText(sub).width; lineChunks.push({ ...chunk, text: sub, width: w, font, size }); lineW += w; }
                lines.push({ chunks: lineChunks, totalWidth: lineW }); lineChunks = []; lineW = 0; sub = ''; continue;
            }
            const test = sub + ch;
            if (lineW + ctx.measureText(test).width > maxWidth && (lineW > 0 || sub.length > 0)) {
                if (sub) { const w = ctx.measureText(sub).width; lineChunks.push({ ...chunk, text: sub, width: w, font, size }); lineW += w; }
                lines.push({ chunks: lineChunks, totalWidth: lineW }); lineChunks = []; lineW = 0; sub = ch;
            } else { sub = test; }
        }
        if (sub) { const w = ctx.measureText(sub).width; lineChunks.push({ ...chunk, text: sub, width: w, font, size }); lineW += w; }
    }
    if (lineChunks.length > 0) lines.push({ chunks: lineChunks, totalWidth: lineW });
    return lines.length ? lines : [{ chunks: [], totalWidth: 0 }];
}

/* ============================================================
 * 캔버스 유틸리티
 * ============================================================ */
/* 언어별 Noto 폰트 우선순위.
 * 일본어·중국어 간체·번체 한자는 같은 유니코드를 공유하는데 글자 모양(획·부수)이 다르다.
 * 캔버스는 lang 속성을 보지 않고 '코드포인트가 있는 첫 폰트'를 쓰므로, 선택한 언어의 폰트를
 * 앞으로 보내야 그 언어의 글자 모양으로 그려진다.
 * 한글·라틴은 Paperlogy/Pretendard 가 앞에서 처리하므로 여기서는 Noto 순서만 바꾼다. */
const LANG_NOTO_ORDER = {
    ko:   ['Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans Thai'],
    ja:   ['Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans Thai'],
    zhCN: ['Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', 'Noto Sans Thai'],
    zhTW: ['Noto Sans TC', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans Thai'],
    th:   ['Noto Sans Thai', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC']
};
/* 선택 언어에 맞춘 캔버스 폰트 체인. 금액 숫자(cheoeumcheoreom)는 숫자 전용이라 언어 영향 없음. */
function buildFonts(lang) {
    const noto = (LANG_NOTO_ORDER[lang] || LANG_NOTO_ORDER.ko).map(f => `'${f}'`).join(',');
    return {
        main: `'Paperlogy','Pretendard',${noto},sans-serif`,
        bold: `'GmarketSansBold',${noto},sans-serif`,
        medium: `'GmarketSansMedium',${noto},sans-serif`,
        cheoeumcheoreom: "'GmarketSansBold',sans-serif"
    };
}
const CONFIG = {
    W: 1240, H: 1754, SCALE: 2,
    fonts: buildFonts('ko')
};
/* 문서 언어 변경 — 폰트 체인을 다시 만들어 CONFIG 에 반영(이후 렌더부터 적용). */
function applyDocLang(lang) {
    docLang = LANG_NOTO_ORDER[lang] ? lang : 'ko';
    CONFIG.fonts = buildFonts(docLang);
}

/* ── 캔버스 웹폰트 도착 확인 ──
 * 이 폰트들은 style.css 의 @font-face 로만 선언돼 있고 화면(DOM)에서는 쓰이지 않는다.
 * 오직 ctx.font 로만 쓰이는데, 캔버스 사용이 웹폰트 다운로드를 유발하는지는 브라우저마다
 * 달라 보장할 수 없다. 그래서 여기서 명시적으로 요청하고 도착 여부까지 확인한다.
 *
 * 확인이 필요한 이유 — 폰트를 못 받으면 대체 글꼴로 조용히 그려진다. 미리보기에도 같은
 * 모습이라 화면만으로는 알아채기 어렵고, 그대로 인쇄되면 재인쇄 비용이 든다.
 *
 * 한국어 핵심 4종만 본다. Noto(일·중·태)는 유니코드 서브셋으로 쪼개져 들어와
 * '필요 없어서 안 받은 것'과 '못 받은 것'을 구분할 수 없다 — 헛경보를 내느니 뺀다.
 * 굵기는 @font-face 에 선언된 값을 그대로 쓴다(파일 도착 여부만 보면 되므로). */
const CANVAS_WEBFONTS = [
    { spec: "400 20px 'Paperlogy'",         sample: '가', label: '본문' },
    { spec: "700 20px 'Paperlogy'",         sample: '가', label: '제목' },
    { spec: "400 20px 'GmarketSansBold'",   sample: '0',  label: '금액' },
    { spec: "400 20px 'GmarketSansMedium'", sample: '가', label: '단위' }
];

/* 캔버스 폰트를 명시적으로 불러오고, 못 받은 것의 이름을 돌려준다.
 * 하나가 실패해도 나머지는 계속 기다린다 — 어디까지 됐는지 알려야 안내가 정확해진다. */
function loadCanvasWebfonts() {
    if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve([]);
    return Promise.all(CANVAS_WEBFONTS.map(f =>
        document.fonts.load(f.spec, f.sample)
            // 일치하는 @font-face 가 없으면 빈 배열이 온다(예외가 아니다).
            // 폰트 CSS 자체를 못 받은 경우가 여기에 해당하므로 길이를 반드시 본다.
            .then(faces => (faces && faces.length ? null : f.label))
            .catch(() => f.label)
    )).then(missing => [...new Set(missing.filter(Boolean))]);
}

/* 폰트 경고 배너 — 렌더 경고(setFloatingWarn)와 달리 스스로 지워지지 않는다.
 * 새로고침해야 해결되는 환경 문제라, 사용자가 조치할 때까지 남겨 둔다. */
function setFontWarn(missing) {
    const el = document.getElementById('fontWarn');
    if (!el) return;
    if (!missing || !missing.length) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = `⚠ 글꼴을 불러오지 못했습니다 (${missing.join('·')}) — `
        + '인쇄물 글자 모양과 줄바꿈이 평소와 달라집니다. '
        + '네트워크 연결을 확인한 뒤 새로고침해 주세요.';
    el.hidden = false;
}

/* 폰트를 받아 정확한 메트릭으로 다시 그리고, 못 받은 게 있으면 알린다.
 * 실패해도 렌더는 반드시 한 번 돈다 — 대체 글꼴로라도 보이는 편이 빈 화면보다 낫다.
 * 프로미스를 돌려주는 이유는 테스트가 완료 시점을 붙잡기 위해서다(앱은 기다리지 않는다). */
function verifyCanvasFonts() {
    return loadCanvasWebfonts().then(missing => {
        setFontWarn(missing);
        if (missing.length) console.warn('[폰트] 불러오지 못함:', missing.join(', '));
        generateImages();
    }).catch(err => {
        console.error('[폰트] 확인 실패:', err);
        generateImages();
    });
}

/* ── 문서 언어 자동 판별 ──
 * 겹칠 수 없는 문자 대역(태국·가나·한글)이 있으면 그것으로 확정한다.
 * 한자만 있으면 간체/번체를 가려야 하는데, 이때만 아래 글자표로 개수를 센다.
 * 판별이 틀려도 네 가지 Noto 가 모두 체인에 남아 있어 글자가 깨지지는 않는다
 * (공통 한자의 획 모양만 달라짐). */
const RE_THAI   = /[฀-๿]/;
const RE_KANA   = /[぀-ヿ]/;
const RE_HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
const RE_HAN    = /[一-鿿㐀-䶿]/;

/* 간체/번체 판별용 글자표 — 같은 자리끼리 대응하는 쌍이다.
 * 두 서체 모두에서 정상적으로 쓰이는 글자(干·后·只·云·里·面·台·余 등)는
 * 오판을 부르므로 일부러 뺐다. 획이 확실히 갈리는 것만 남긴다. */
const HANZI_SIMP = (
    '医疗药学会国时个们这样义习书术广员价优预约万减双肤脱门问间闻闭闲阅队阴阳际险隐难观欢权劝鸡' +
    '邓圣树戏说语请谢课读论议讯记讲认让训计订讨设访证评识诉诊词译试诗详误谁调谈谊谋谓谜谱钱银铁' +
    '钢铜针钟锁错镜铺链钻锋镇铝钙车转轮软输较轻载辆辅马驾驶骑验骗驻骄鸟鸭鹅鸿鹤鱼鲜鲍贝财货贵费' +
    '贸资赛赚购贴赠赞质贷账赔风飘饭饮饰饱馆饼养红级纪纯纲纳纵纷纸纹线练组细织终绍经结给绝绢绣继' +
    '绩绪续绳维绵综绿缓编缘缝缩缴长韦齿龙龟业东爱办报边变标丰达带单点电动儿发飞关汉华获击历丽两' +
    '灵刘乱买卖恼脑宁农齐启气签墙穷区丧扫伤声胜实势兽寿数属虽随湾为卫务献乡写寻压严亿忆应营邮与' +
    '园远愿运杂灾赃战张专庄装状总层尝陈称迟处触传创担胆导灯递独夺妇盖巩沟构顾柜号怀坏环还积极艰' +
    '奖阶洁仅惊竞旧剧据惧开块亏蜡兰拦栏烂垒类礼联怜炼粮辽猎临邻岭庐炉陆驴罗萝逻骂麦猫霉梦庙灭亩' +
    '拟酿盘苹凭扑牵纤亲琼确扰热洒伞涩晒湿适帅苏态坛叹体条听厅头图团网稳雾牺虾吓显宪县响协胁兴悬' +
    '选盐痒钥爷页拥忧渊跃郑肿众昼烛筑桩妆壮浊'
);
const HANZI_TRAD = (
    '醫療藥學會國時個們這樣義習書術廣員價優預約萬減雙膚脫門問間聞閉閒閱隊陰陽際險隱難觀歡權勸雞' +
    '鄧聖樹戲說語請謝課讀論議訊記講認讓訓計訂討設訪證評識訴診詞譯試詩詳誤誰調談誼謀謂謎譜錢銀鐵' +
    '鋼銅針鐘鎖錯鏡鋪鏈鑽鋒鎮鋁鈣車轉輪軟輸較輕載輛輔馬駕駛騎驗騙駐驕鳥鴨鵝鴻鶴魚鮮鮑貝財貨貴費' +
    '貿資賽賺購貼贈讚質貸賬賠風飄飯飲飾飽館餅養紅級紀純綱納縱紛紙紋線練組細織終紹經結給絕絹繡繼' +
    '績緒續繩維綿綜綠緩編緣縫縮繳長韋齒龍龜業東愛辦報邊變標豐達帶單點電動兒發飛關漢華獲擊歷麗兩' +
    '靈劉亂買賣惱腦寧農齊啟氣簽牆窮區喪掃傷聲勝實勢獸壽數屬雖隨灣為衛務獻鄉寫尋壓嚴億憶應營郵與' +
    '園遠願運雜災贓戰張專莊裝狀總層嘗陳稱遲處觸傳創擔膽導燈遞獨奪婦蓋鞏溝構顧櫃號懷壞環還積極艱' +
    '獎階潔僅驚競舊劇據懼開塊虧蠟蘭攔欄爛壘類禮聯憐煉糧遼獵臨鄰嶺廬爐陸驢羅蘿邏罵麥貓黴夢廟滅畝' +
    '擬釀盤蘋憑撲牽纖親瓊確擾熱灑傘澀曬濕適帥蘇態壇嘆體條聽廳頭圖團網穩霧犧蝦嚇顯憲縣響協脅興懸' +
    '選鹽癢鑰爺頁擁憂淵躍鄭腫眾晝燭築樁妝壯濁'
);
/* 문서 전체 텍스트로 언어를 판별. 판별 근거가 없으면 기본값(ko/zhCN). */
function detectDocLang(text) {
    const t = String(text || '');
    if (RE_THAI.test(t)) return 'th';
    if (RE_KANA.test(t)) return 'ja';
    if (RE_HANGUL.test(t)) return 'ko';
    if (!RE_HAN.test(t)) return 'ko';   // 숫자·영문뿐 — 한자 모양을 따질 것이 없음
    let simp = 0, trad = 0;
    for (const ch of t) {
        if (HANZI_SIMP.includes(ch)) simp++;
        else if (HANZI_TRAD.includes(ch)) trad++;
    }
    return trad > simp ? 'zhTW' : 'zhCN';
}
/* 판별에 쓸 문서 텍스트 모으기 — 헤더 3칸 + 항목 영역의 모든 입력칸
 * (섹션 제목·항목명·단위·금액·비고가 전부 여기에 들어간다). */
function collectDocText() {
    const parts = ['topText', 'periodText', 'periodNote'].map(id => document.getElementById(id)?.value || '');
    document.getElementById('itemsContainer')
        ?.querySelectorAll('input[type="text"], textarea')
        .forEach(el => parts.push(el.value));
    return parts.join('\n');
}
/* 렌더 직전에 호출 — 측정·그리기가 모두 같은 폰트 체인을 쓰도록 가장 먼저 적용한다. */
function syncDocLang() {
    applyDocLang(detectDocLang(collectDocText()));
}

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
/* 항목명 줄 간격(행간) 배수. 1.0 = 글자 크기와 동일(빡빡), 1.2 = 약간 여유 */
const ITEM_LINE_HEIGHT = 1.2;
/* 나란히(side) 항목의 최소 행 높이 = 가격 숫자 크기(numSize) × 이 배율.
 * 고정 px가 아니라 텍스트 크기에 비례 → 글자를 키우면 행도 같이 커지고, 줄이면 같이 납작해짐
 * (자동 맞춤이 텍스트를 줄일 때 행도 따라 줄어 한 장에 더 잘 들어감).
 * 기본 numSize 35 × 1.25 = 43.75 ≈ 44px (기존 고정값과 동일). */
const MIN_ROW_H_RATIO = 1.25;
/* 가격 줄(티어) 세로 메트릭 — 글자 크기(numSize)에 비례시켜 글씨를 키워도 줄/라벨이 겹치지 않게 함.
 * numSize 35 기준: 슬롯 높이 35, 줄 간격 -3(겹침)와 동일. */
function priceTierH(numSize) { return numSize; }
function priceRowGap(numSize) { return Math.round(numSize * -3 / 35); }
/* 아래로(스택) 모드의 상하 여백 = 나란히 모드의 실제 보이는 여백과 동일.
 * 나란히는 행 높이 numSize×1.25 안에 numSize 가격 숫자를 중앙 배치 → 위아래 (numSize×0.25)/2 만큼 보임.
 * 스택 모드 상/하 패딩을 이 값으로 맞춰 두 모드의 보이는 여백을 일치시킴(numSize 35 → 약 4px). */
function stackPadY(numSize) { return Math.round(numSize * (MIN_ROW_H_RATIO - 1) / 2); }
/* 세로배치(스택) 모드 항목명 상단 여백(px). stackPadY(기본 ~4px)보다 조금 여유 있게 고정 */
const STACK_NAME_TOP = 6;
/* 비고 텍스트와 윗 내용 사이 간격(스택 모드). 작을수록 비고가 위 내용에 붙음 */
const NOTE_TOP_GAP = 4;
/* 가격을 이름 우측에 나란히 둘지(false) 아래로 내릴지(스택) 판단용.
 * 가격을 뺀 이름 폭이 전체의 STACK_MIN_NAME_RATIO 미만이면 스택. */
const STACK_SIDE_GAP = 12;
const STACK_MIN_NAME_RATIO = 0.42;
/* 여러 줄 항목명의 세로 높이. 줄 사이 간격에만 행간 배수를 적용(첫·끝 줄 반높이 포함).
 * f=1 이면 단순 합과 동일 → 측정/그리기 양쪽에서 같은 식 사용. */
function nameBlockHeight(lineHeights, f) {
    const n = lineHeights.length;
    if (!n) return 0;
    let h = (lineHeights[0] + lineHeights[n - 1]) / 2;
    for (let i = 1; i < n; i++) h += (lineHeights[i - 1] + lineHeights[i]) / 2 * f;
    return h;
}
/* 항목 레이아웃 판정: 가격을 이름 우측에 나란히(side) vs 아래로(stack).
 * item.priceLayout 이 'side'/'stack' 이면 사용자가 고정한 값을 그대로 따름(가드 무시).
 * 미설정이면 두 레이아웃 본문 높이를 비교해 자동 선택(이름 최소폭 가드 + 더 낮은 쪽). */
function computeItemLayout(ctx, item, colW, fonts, NAME_SIZE, numSize, grid = null) {
    const PAD_X = 18, PAD_Y = 12, PRICE_TIER_H = priceTierH(numSize), PRICE_ROW_GAP = priceRowGap(numSize), PRICE_GAP = 1;
    const innerW = colW - PAD_X * 2;
    const getLineH = line => line.chunks.length ? Math.max(...line.chunks.map(c => c.size || NAME_SIZE)) : NAME_SIZE;
    const blockH = lines => nameBlockHeight(lines.map(getLineH), ITEM_LINE_HEIGHT);
    const tiers = buildTiers(item);
    const priceW = tiers.length ? measurePriceTiersWidth(ctx, tiers, numSize, fonts) : 0;
    // 기본값은 '나란히'(side). priceLayout 이 'stack' 일 때만 아래로, 그 외(미설정 포함)는 나란히.
    const force = item.priceLayout === 'stack' ? 'stack' : 'side';

    if (!tiers.length) {   // 가격 없음 → 전체폭 이름 (강제값 무관)
        const nameLines = wrapStyledText(ctx, item.itemName, Math.floor(innerW), NAME_SIZE, false, fonts);
        return { tiers, isStacked: false, nameLines, nameBlockH: blockH(nameLines), tierRows: [], priceTotalH: 0 };
    }

    // 스택 레이아웃(전체폭 이름 + 아래 가격) 본문 높이
    const fullLines = wrapStyledText(ctx, item.itemName, Math.floor(innerW), NAME_SIZE, false, fonts);
    const tierRows = packTierRows(ctx, tiers, innerW, numSize, fonts);
    const nRows = tierRows.length || 1;
    const priceTotalH = nRows * PRICE_TIER_H + (nRows - 1) * PRICE_ROW_GAP;

    if (force === 'stack') {
        return { tiers, isStacked: true, nameLines: fullLines, nameBlockH: blockH(fullLines), tierRows, priceTotalH };
    }
    // 나란히. 2·3열 좁은 칸(cols>=2)에 가격이 2개 이상이면 세로로 쌓고 하단 정렬(한 줄에 한 티어, 우측 정렬).
    // 가격 1개짜리는 쌓을 게 없으니 기존 가로 나란히(세로 중앙) 유지 → 불필요한 여백 방지.
    if (itemColCount(item) >= 2 && tiers.length >= 2) {
        // 단위박스 우측 통일을 반영한 블록 폭 = 한 줄 한 티어짜리 열 그리드 폭(단위박스 최대 + 간격 + 금액 최대)
        const vTierRows = tiers.map(t => [t]);                                                      // 한 티어 = 한 줄
        const tierW = grid ? tierRowWidthInGrid(grid, 1) : computeTierGrid(ctx, vTierRows, numSize, fonts).totalW;
        const sideNameW = Math.max(innerW - tierW - STACK_SIDE_GAP, Math.floor(innerW * 0.25));
        const sideLines = wrapStyledText(ctx, item.itemName, Math.floor(sideNameW), NAME_SIZE, false, fonts);
        const vPriceTotalH = tiers.length * PRICE_TIER_H + (tiers.length - 1) * PRICE_ROW_GAP;
        return { tiers, isStacked: false, sideVerticalTiers: true, nameLines: sideLines, nameBlockH: blockH(sideLines), tierRows: vTierRows, priceTotalH: vPriceTotalH };
    }
    // 가로 나란히: 이름 폭은 가격을 뺀 나머지(가격이 넓어도 이름이 사라지지 않게 최소 25% 확보)
    // 섹션 그리드가 있으면 이 줄이 차지할 열들의 폭을 예약해야 이름과 겹치지 않음
    const sidePriceW = grid ? tierRowWidthInGrid(grid, tiers.length) : priceW;
    const sideNameW = Math.max(innerW - sidePriceW - STACK_SIDE_GAP, Math.floor(innerW * 0.25));
    const sideLines = wrapStyledText(ctx, item.itemName, Math.floor(sideNameW), NAME_SIZE, false, fonts);
    return { tiers, isStacked: false, sideVerticalTiers: false, nameLines: sideLines, nameBlockH: blockH(sideLines), tierRows, priceTotalH };
}

/* 항목 행의 높이 + 내부 오프셋(가격 중심 y·이름 시작 y, startY 기준)을 한 곳에서 계산.
 * measureItemRow(측정)와 drawItemRow(그리기)가 공유 → 두 경로의 높이 공식 분기로 인한
 * 측정/그리기 불일치(파리티 깨짐)를 원천 차단한다. */
function itemRowGeometry(ctx, item, colW, fonts, bodySize = 20, numSize = 35, rowHOverride = null, grid = null, titleSize = 24) {
    if (item.isSublabel) return { isSublabel: true, rowH: sublabelLayout(ctx, item, colW, fonts, bodySize, titleSize).rowH, L: null, noteH: 0, priceCenterOff: 0, nameStartOff: 0 };
    const NAME_SIZE = bodySize, PAD_Y = 12, NOTE_SIZE = Math.round(bodySize * 0.85);  // 비고 (본문 크기 연동)
    const noteH = item.note ? noteLayout(ctx, item.note, colW, NOTE_SIZE, fonts).H : 0;
    const L = computeItemLayout(ctx, item, colW, fonts, NAME_SIZE, numSize, grid);
    const getLineH = line => line.chunks.length ? Math.max(...line.chunks.map(c => c.size || NAME_SIZE)) : NAME_SIZE;
    const firstLineH = L.nameLines[0] ? getLineH(L.nameLines[0]) : NAME_SIZE;
    const PRICE_TIER_H = priceTierH(numSize), PRICE_GAP = 1;
    let rowH, priceCenterOff, nameStartOff;
    if (L.isStacked) {
        const SPAD = stackPadY(numSize);   // 하단 여백은 나란히 모드와 동일하게 유지
        const TOP = STACK_NAME_TOP;        // 항목명 상단 여백만 조금 여유 있게(6px)
        rowH = TOP + Math.ceil(L.nameBlockH) + PRICE_GAP + L.priceTotalH + (noteH ? NOTE_TOP_GAP : SPAD) + noteH;
        priceCenterOff = TOP + Math.ceil(L.nameBlockH) + PRICE_GAP + PRICE_TIER_H / 2;
        nameStartOff = TOP + firstLineH / 2;
        // 다열 행에서 더 큰 행 높이로 정렬: 스택형은 상단 기준 유지(아래 여백만 늘어남)
        if (rowHOverride != null && rowHOverride > rowH) rowH = rowHOverride;
    } else {
        // 나란히. 세로 티어면 가격 블록 높이도 내용 높이에 포함(이름·가격 중 큰 쪽)
        const SPAD = stackPadY(numSize);   // 아래로 모드와 동일한 좁은 상하 여백
        // 가격 블록 높이도 내용에 포함(가로 다중가격·단일가격은 numSize, 세로 티어는 priceTotalH).
        // 비고가 있으면 가격 숫자(numSize)를 무시하던 기존 버그로 가격이 위로 넘쳐 상단에 치우침 → 여기서 방지.
        const priceBlockH = L.sideVerticalTiers ? L.priceTotalH : numSize;
        const contentH = Math.max(Math.ceil(L.nameBlockH), priceBlockH);
        rowH = Math.max(contentH + SPAD * 2 + noteH, Math.round(numSize * MIN_ROW_H_RATIO));
        if (rowHOverride != null && rowHOverride > rowH) rowH = rowHOverride;
        const priceAreaH = rowH - noteH;
        // 나란히(가격이 이름 옆): 이름은 세로 중앙 정렬. 가격은 1개면 중앙, 2개 이상이면 drawItemRow가 하단 정렬.
        priceCenterOff = priceAreaH / 2;
        nameStartOff = priceAreaH / 2 - (L.nameBlockH - firstLineH) / 2;
    }
    return { isSublabel: false, rowH, L, noteH, priceCenterOff, nameStartOff };
}
function measureItemRow(ctx, item, colW, fonts, bodySize = 20, numSize = 35, grid = null, titleSize = 24) {
    return itemRowGeometry(ctx, item, colW, fonts, bodySize, numSize, null, grid, titleSize).rowH;
}
/* 항목의 가로 칸 수 정규화(1·2·3). 소제목은 항상 1(전체폭). */
function itemColCount(item) {
    if (item.isSublabel) return 1;
    const n = parseInt(item.cols, 10);
    return n === 2 || n === 3 ? n : 1;
}
/* 섹션 폭을 N칸으로 나눈 각 칸의 폭(합이 정확히 totalW가 되도록 마지막 칸이 나머지 흡수). */
function itemColWidths(totalW, cols) {
    const base = Math.floor(totalW / cols);
    const widths = new Array(cols).fill(base);
    widths[cols - 1] = totalW - base * (cols - 1);
    return widths;
}
/* 항목들을 가로 칸 기준으로 행 그룹으로 묶는다.
 * 규칙: 같은 cols 값의 연속 항목을 한 행에 cols개까지 채우고, 꽉 차거나 값이 바뀌거나
 * 소제목을 만나면 줄바꿈. 각 그룹은 의도한 칸 수(cols)를 보존 → 항목이 모자라도(leftover)
 * 칸 폭은 totalW/cols 로 유지(예측 가능). */
function packItemRows(items) {
    const rows = [];
    let i = 0;
    while (i < items.length) {
        const cols = itemColCount(items[i]);
        if (cols === 1) { rows.push({ cols: 1, items: [items[i]] }); i++; continue; }
        const group = [items[i]]; i++;
        while (group.length < cols && i < items.length && !items[i].isSublabel && itemColCount(items[i]) === cols) {
            group.push(items[i]); i++;
        }
        rows.push({ cols, items: group });
    }
    return rows;
}
/* 한 섹션 안에서 '같은 자리'(칸 수 + 칸 번호)에 놓인 항목들이 공유할 가격 열 그리드.
 * 항목마다 따로 정렬하면 행이 바뀔 때 단위박스가 어긋나므로, 섹션 전체를 한 그리드로 묶어
 * 단위박스·금액이 항목 행을 가로질러 세로 일직선에 놓이게 한다.
 * 반환: Map<`${cols}:${칸번호}`, grid>. 그리드가 칸에 안 들어가는 그룹은 넣지 않음(항목별 정렬로 폴백). */
function computeSectionGrids(ctx, sec, colW, fonts) {
    const PAD_X = 18;
    const bs = sec.bodySize || 20, ns = sec.numSize || 35;
    const groups = new Map();
    for (const grp of packItemRows(sec.items)) {
        const widths = itemColWidths(colW, grp.cols);
        grp.items.forEach((it, c) => {
            if (it.isSublabel) return;
            const L = computeItemLayout(ctx, it, widths[c], fonts, bs, ns);
            if (!L.tiers.length) return;
            // 실제로 그려지는 줄 구성 — 나란히 단일행이면 티어 전체가 한 줄
            const drawnRows = (L.sideVerticalTiers || L.isStacked) ? L.tierRows : [L.tiers];
            if (!drawnRows.length) return;
            const key = `${grp.cols}:${c}`;
            let g = groups.get(key);
            if (!g) { g = { rows: [], innerW: widths[c] - PAD_X * 2, sideMaxCols: 0 }; groups.set(key, g); }
            g.rows.push(...drawnRows);
            // 가격이 이름 옆에 오는(나란히) 항목이 실제로 쓰는 최대 열 수 — 이름 자리를 남겨야 하는 쪽
            if (!L.isStacked) g.sideMaxCols = Math.max(g.sideMaxCols, ...drawnRows.map(r => r.length));
        });
    }
    const out = new Map();
    for (const [key, g] of groups) {
        if (g.rows.length < 2) continue;                    // 맞출 상대가 없음 → 항목별 정렬로 충분
        const grid = computeTierGrid(ctx, g.rows, ns, fonts);
        if (grid.totalW > g.innerW) continue;               // 칸을 넘으면 정렬 포기
        // 나란히 항목은 이름 최소폭(25%)을 남겨야 겹치지 않음 — 그 항목이 실제 쓰는 열까지만 따짐
        if (g.sideMaxCols > 0 && tierRowWidthInGrid(grid, g.sideMaxCols) > Math.floor(g.innerW * 0.75)) continue;
        out.set(key, grid);
    }
    return out;
}
/* 섹션 그리드 캐시 — 측정(measureSection)과 그리기(drawSection)가 같은 값을 쓰도록 섹션 객체에 보관.
 * 섹션 객체는 렌더마다 parseDomToPages 가 새로 만들므로 캐시 수명은 한 번의 렌더. */
function sectionTierGrids(ctx, sec, colW, fonts) {
    const key = `${colW}|${sec.bodySize}|${sec.numSize}`;
    if (sec._gridKey !== key) { sec._gridKey = key; sec._grids = computeSectionGrids(ctx, sec, colW, fonts); }
    return sec._grids;
}

function measureSection(ctx, sec, colW, fonts) {
    let h = sec.title ? (sec.titleSize || 24) + 16 : 0;
    const bs = sec.bodySize || 20, ns = sec.numSize || 35, ts = sec.titleSize || 24;
    const grids = sectionTierGrids(ctx, sec, colW, fonts);
    const itemRows = packItemRows(sec.items);
    for (let r = 0; r < itemRows.length; r++) {
        const grp = itemRows[r];
        const widths = itemColWidths(colW, grp.cols);
        let rowH = 0;
        grp.items.forEach((it, c) => { rowH = Math.max(rowH, measureItemRow(ctx, it, widths[c], fonts, bs, ns, grids.get(`${grp.cols}:${c}`), ts)); });
        h += rowH + sublabelBottomPad(grp, r === itemRows.length - 1);
    }
    return h;
}
/* 마지막 항목이 소제목이면 아래쪽 흰 여백(HEADER_INSET)만큼 행을 키운다.
 * 그래야 칠해지는 띠 높이가 제목 박스와 같아지고, 띠 반경도 카드 반경과 동심원으로 맞는다. */
function sublabelBottomPad(grp, isLastRow) {
    return (isLastRow && grp.items[0]?.isSublabel) ? HEADER_INSET : 0;
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

/* A4 페이지 바깥 여백(px)·컬럼 사이 가로 간격(px) — 측정/그리기 공통, 한 곳에서만 정의 */
const MARGIN = 41;
const COL_GAP = 10;
/* 이벤트 박스(섹션) 모서리 반경(px, 캔버스 좌표 기준) — '박스 모서리' 선택값별 */
const BOX_CORNER_RADIUS = { sharp: 0, soft: 10, round: 24 };
function currentBoxRadius() {
    const r = BOX_CORNER_RADIUS[boxCornerStyle];
    return Number.isFinite(r) ? r : BOX_CORNER_RADIUS.round;
}
const HEADER_INSET = 3;   // 제목 박스를 흰 카드 안쪽으로 들여쓰는 여백(px) — 둘레에 흰 테두리 링
/* 제목 박스가 실제로 칠해지는 세로 높이 — 섹션 헤더 영역(제목크기+16)에서 위쪽 들여쓴 만큼 뺀 값.
 * 소제목 기본 높이를 여기에 맞춰 두 띠의 두께가 같아 보이게 한다. */
function titleBarHeight(titleSize) { return (titleSize || 24) + 16 - HEADER_INSET; }
/* 안쪽 띠(제목 박스·소제목 띠)가 카드 모서리를 따라갈 때 쓸 카드 반경.
 * 띠는 자기 높이의 절반보다 큰 반경을 그릴 수 없다(canvas 가 자동으로 줄임).
 * 카드가 그보다 둥글면 띠 반경만 잘려 모서리 쪽 흰 여백이 직선부보다 얇아 보이므로,
 * 띠가 소화할 수 있는 만큼으로 카드 반경을 낮춰 사방 여백을 HEADER_INSET 로 일정하게 맞춘다. */
function cardRadiusForBar(barH) {
    return Math.max(0, Math.min(currentBoxRadius(), barH / 2 + HEADER_INSET));
}
/* 이 섹션 카드에 실제로 쓸 모서리 반경 — 위(제목 박스)·아래(마지막 소제목 띠) 제약 중 작은 쪽.
 * 카드와 안쪽 띠가 같은 값을 써야 동심원이 되어 여백이 균일해진다. */
function sectionCardRadius(sec) {
    if (!sec) return currentBoxRadius();
    const hasItems = (sec.items?.length || 0) > 0;
    const barH = titleBarHeight(sec.titleSize);
    let r = currentBoxRadius();
    if (sec.title) r = Math.min(r, cardRadiusForBar(barH - (hasItems ? 0 : HEADER_INSET)));
    if (hasItems && sec.items[sec.items.length - 1]?.isSublabel) r = Math.min(r, cardRadiusForBar(barH));
    return r;
}

/* 항목 구분선 스타일별 파선 패턴(setLineDash 인자). null 이면 그리지 않음. */
const ITEM_DIVIDER_DASH = { none: null, dotted: [1, 3], dashed: [8, 5], solid: [] };
/* 항목 구분선 그리기 준비 — 선택된 스타일을 ctx 에 적용. '없음'이면 false(그리지 않음).
 * 그린 뒤에는 반드시 endItemDivider 로 파선 설정을 되돌려야 다른 선에 번지지 않는다. */
function beginItemDivider(ctx, themeColor) {
    const dash = ITEM_DIVIDER_DASH[itemDividerStyle];
    if (!dash) return false;
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = itemDividerStyle === 'dotted' ? 1.2 : 0.5;
    ctx.lineCap = itemDividerStyle === 'dotted' ? 'round' : 'butt';
    ctx.setLineDash(dash);
    return true;
}
function endItemDivider(ctx) { ctx.setLineDash([]); ctx.lineCap = 'butt'; }
/* 섹션 사이 기본 간격(px) — 슬라이더 미설정 시 폴백 */
const SECTION_GAP = 15;
/* 사용자가 '왼쪽 간격' 슬라이더로 조절한 섹션 사이 세로 간격(px). 미설정 시 기본값.
 * 왼쪽 컬럼·전체폭 섹션·세로 흐름 간격의 기준값. */
function currentSectionGap() {
    const v = parseInt(document.getElementById('sectionGap')?.value, 10);
    return Number.isFinite(v) ? v : SECTION_GAP;
}
/* '오른쪽 간격' 슬라이더 값(오른쪽 컬럼 전용). 없으면 왼쪽 값으로 폴백. */
function currentSectionGapRight() {
    const el = document.getElementById('sectionGapRight');
    if (!el) return currentSectionGap();
    const v = parseInt(el.value, 10);
    return Number.isFinite(v) ? v : currentSectionGap();
}
/* 헤더(제목·기간) 아래와 섹션 시작 사이 간격. 작을수록 섹션이 상단 텍스트에 붙음 */
const HEADER_CONTENT_GAP = 5;

/* ── 상단 로고 ──
 * 로고는 헤더 밴드 위쪽에 얹히고, 그만큼 헤더가 아래로 늘어나 제목·기간이 밀려난다.
 * 즉 로고 블록 높이 = 위 여백 + 로고 높이 + 제목까지의 간격. */
const LOGO_BASE_H = 86;     // 크기 100% 기준 로고 높이(px, 1240×1754 캔버스 기준)
const LOGO_MAX_W = 420;     // 100% 기준 가로 상한 — 가로로 긴 로고가 페이지 폭을 잡아먹지 않게
const LOGO_GAP = 16;        // 로고 ~ 제목

/* 로고의 실제 그리기 크기·세로 위치와 헤더에서 차지할 높이. 로고가 없으면 null.
 * top 은 페이지 상단에서 로고까지의 여백이라, 키우면 로고와 제목이 함께 내려간다. */
function logoMetrics(img = cachedLogoImg, scalePct = logoSizePct, topPad = logoTopPad) {
    if (!img || !img.width || !img.height) return null;
    const s = (Number(scalePct) || LOGO_SCALE_DEFAULT) / 100;
    let h = LOGO_BASE_H * s;
    let w = h * (img.width / img.height);
    const maxW = LOGO_MAX_W * s;
    if (w > maxW) { w = maxW; h = w * (img.height / img.width); }
    // 0 이 유효한 값이라 `|| 기본값` 을 쓸 수 없다. 또 Number(null) 은 NaN 이 아니라 0 이므로
    // 값이 없는 경우(null·undefined)를 ?? 로 먼저 걸러야 0 으로 오인되지 않는다.
    const t = Number(topPad ?? LOGO_TOP_DEFAULT);
    const top = Math.min(Math.max(Number.isFinite(t) ? t : LOGO_TOP_DEFAULT, LOGO_TOP_MIN), LOGO_TOP_MAX);
    return { w, h, top, blockH: top + h + LOGO_GAP };
}
function logoBlockHeight(img = cachedLogoImg, scalePct = logoSizePct, topPad = logoTopPad) {
    return logoMetrics(img, scalePct, topPad)?.blockH || 0;
}
/* 균등 맞춤 시 섹션 사이 간격 상한 — 내용이 적어도 이 이상은 벌어지지 않음(빈 느낌 방지).
 * 이 값을 키우면 더 꽉 채우고(간격↑), 줄이면 간격을 좁게 유지(하단 여백↑). */
const MAX_JUSTIFY_GAP = 60;

/* 오프스크린 측정 전용 컨텍스트 (높이 균형 계산용) */
let _measureCtx = null;
function getMeasureCtx() {
    if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
    return _measureCtx;
}

/* drawA4Canvas 와 동일한 2컬럼 폭 계산 (높이 균형 계산 시 사용) */
function computeTwoColW() {
    const { W } = CONFIG;
    return Math.floor((W - MARGIN * 2 - COL_GAP) / 2);
}

/* 한 컬럼 내 섹션 y좌표 계산.
 * justify=true 이면 남는 세로 공간을 섹션 사이 간격에 균등 분배해 두 컬럼 하단을 맞춤.
 *   - bottomExact=false: 간격을 MAX_JUSTIFY_GAP 으로 상한 — 내용이 적으면 상단 정렬 + 하단 여백.
 *   - bottomExact=true : 상한 없이 남는 공간을 전부 간격에 분배해 마지막 섹션 하단을 bottomY 에 정확히 맞춤.
 *     (잔여가 작을수록 간격은 최소(SECTION_GAP)에 가까움 — 텍스트 크기 최적화로 잔여를 줄임)
 * 섹션이 1개뿐이면 분배할 간격이 없어 상단 정렬로 둠. */
function layoutColumn(ctx, sections, startY, bottomY, colW, fonts, justify, bottomExact, baseGap) {
    if (!Number.isFinite(baseGap)) baseGap = currentSectionGap();   // 이 컬럼의 기본 섹션 간격
    const heights = sections.map(sec => measureSection(ctx, sec, colW, fonts));
    const contentH = heights.reduce((a, b) => a + b, 0);
    let gap = baseGap;
    if (justify && sections.length > 1) {
        const avail = bottomY - startY - contentH;            // 남는 세로 공간
        if (avail > 0) {
            const evenGap = avail / (sections.length - 1);
            // 하단 정확 맞춤: 상한 없이 전부 분배(바닥 정확 일치). 일반: 상한으로 빈 느낌 방지.
            gap = bottomExact ? Math.max(baseGap, evenGap) : Math.min(evenGap, MAX_JUSTIFY_GAP);
        }
    }
    const positions = [];
    let y = startY;
    for (let i = 0; i < sections.length; i++) {
        if (y >= bottomY) break;   // 넘치면 클립 (기존 동작 유지)
        positions.push({ sec: sections[i], y, h: heights[i] });
        y += heights[i] + gap;
    }
    const last = positions[positions.length - 1];
    return { positions, endY: last ? last.y + last.h : startY };
}

/* ============================================================
 * 캔버스 렌더링 — A4 두 컬럼 레이아웃
 * ============================================================ */
function drawA4Canvas(bgImg, rows, headerRatio, themeColor, numColor = '#000000', topText = '', periodText = '', textColor = '#000000', periodNote = '', hlColor = '#FFEB3B', itemHlColor = '#FF0000', labelBoxColor = '#000000', balance = false, bottomExact = false, rectSink = null, logoImg = null, logoScalePct = LOGO_SCALE_DEFAULT, logoTopPx = LOGO_TOP_DEFAULT) {
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

    // 로고가 있으면 그 블록만큼 헤더가 늘어난다 → 제목·기간이 자동으로 아래로 내려가 자리가 생김.
    // 제목·기간을 그릴지는 사용자가 정한 헤더 높이(bandH)로만 판단한다(로고 때문에 되살아나지 않게).
    const bandH = Math.round(H * headerRatio);
    const logoM = logoMetrics(logoImg, logoScalePct, logoTopPx);
    const headerH = bandH + (logoM ? logoM.blockH : 0);

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
    const contentTop = headerH + (headerH > 0 ? HEADER_CONTENT_GAP : MARGIN);
    const contentBottom = H - MARGIN;
    const twoColW = Math.floor((W - MARGIN * 2 - COL_GAP) / 2);
    const fullW = W - MARGIN * 2;
    const col1X = MARGIN;
    const col2X = MARGIN + twoColW + COL_GAP;

    // 행 레이아웃 1회 계산 — 카드 배경 패스와 그리기 패스가 동일 좌표를 사용하도록.
    // '페이지 끝까지 채우기'(bottomExact)일 때만 마지막 split 행에서 간격을 분배해 하단을 맞춤.
    // 양쪽 높이 맞추기만 켠 경우엔 수동 섹션 간격을 그대로 유지(내용만 좌/우로 나눔).
    const lastRowIdx = rows.length - 1;
    const rowLayouts = [];
    let cy = contentTop;
    rows.forEach((row, ri) => {
        if (cy >= contentBottom) return;
        if (row.type === 'full') {
            const h = measureSection(ctx, row.section, fullW, fonts);
            rowLayouts.push({ type: 'full', section: row.section, y: cy, h });
            cy += h + currentSectionGap();
        } else {
            const justify = bottomExact && ri === lastRowIdx;
            const left = layoutColumn(ctx, row.left, cy, contentBottom, twoColW, fonts, justify, bottomExact, currentSectionGap());
            const right = layoutColumn(ctx, row.right, cy, contentBottom, twoColW, fonts, justify, bottomExact, currentSectionGapRight());
            rowLayouts.push({ type: 'split', left, right });
            cy = Math.max(left.endY, right.endY) + currentSectionGap();
        }
    });

    // 섹션 카드 흰색 배경 + 박스 그림자
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.09)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    // 반경은 섹션마다 계산 — 안쪽 제목/소제목 띠와 동심원이 되어야 여백이 균일하다
    const fillCard = (sec, x, yy, w, h) => {
        if (yy >= contentBottom) return;
        const ch = Math.min(h, contentBottom - yy);
        const r = Math.min(sectionCardRadius(sec), w / 2, ch / 2);
        ctx.beginPath(); ctx.roundRect(x, yy, w, ch, r); ctx.fill();
    };
    for (const rl of rowLayouts) {
        if (rl.type === 'full') fillCard(rl.section, col1X, rl.y, fullW, rl.h);
        else {
            rl.left.positions.forEach(p => fillCard(p.sec, col1X, p.y, twoColW, p.h));
            rl.right.positions.forEach(p => fillCard(p.sec, col2X, p.y, twoColW, p.h));
        }
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // 컨텐츠 렌더링 (배경 패스와 동일 좌표)
    // rectSink 가 주어지면 각 섹션의 위치(W·H 대비 비율)를 기록 → 북마크 클릭 시 미리보기 하이라이트에 사용.
    const recordRect = (sec, x, yy, w, h) => {
        if (!rectSink || !sec || !sec._node || yy >= contentBottom) return;
        const ch = Math.min(h, contentBottom - yy);
        rectSink.rects.push({ node: sec._node, page: rectSink.page, fx: x / W, fy: yy / H, fw: w / W, fh: ch / H });
    };
    // 섹션 본문은 흰 카드와 동일한 둥근 사각형으로 클리핑한 뒤 그린다.
    // (항목 행 배경·소제목 배경이 사각형 fillRect 라서, 클리핑하지 않으면 카드 하단
    //  모서리의 둥근 부분을 덮어 각지게 보임)
    const drawCard = (sec, x, yy, w, h) => {
        if (!sec || yy >= contentBottom) return;
        const ch = Math.min(h, contentBottom - yy);
        const r = Math.min(sectionCardRadius(sec), w / 2, ch / 2);
        ctx.save();
        ctx.beginPath(); ctx.roundRect(x, yy, w, ch, r); ctx.clip();
        drawSection(ctx, sec, x, yy, w, themeColor, numColor, fonts, hlColor, itemHlColor, labelBoxColor);
        ctx.restore();
        recordRect(sec, x, yy, w, h);
    };
    for (const rl of rowLayouts) {
        if (rl.type === 'full') drawCard(rl.section, col1X, rl.y, fullW, rl.h);
        else {
            rl.left.positions.forEach(p => drawCard(p.sec, col1X, p.y, twoColW, p.h));
            rl.right.positions.forEach(p => drawCard(p.sec, col2X, p.y, twoColW, p.h));
        }
    }

    // 상단 로고 — 헤더 밴드 위쪽에 가운데 정렬
    if (logoM) ctx.drawImage(logoImg, (W - logoM.w) / 2, logoM.top, logoM.w, logoM.h);

    // 제목 + 이벤트 기간 (헤더 중앙, 두 줄)
    if (bandH > 0 && (topText || periodText)) {
        ctx.letterSpacing = '0px';
        ctx.textBaseline = 'bottom';
        const TOP_SIZE = 22;
        const titleMaxW = W - MARGIN * 2;
        const TOP_LINE_HEIGHT = 1.28;   // 제목/기간 행간 배수 (22px 기준 ≈ 28px)

        // 줄 높이 = 그 줄에서 가장 큰 글자 크기 × 배수 → 확대/축소 서식에도 행간이 비례해서 벌어짐
        const lineH = (line) => Math.round(
            Math.max(TOP_SIZE, ...line.chunks.map(c => c.size || TOP_SIZE)) * TOP_LINE_HEIGHT
        );

        // 여러 줄(Enter 줄바꿈 또는 자동 줄바꿈)을 baselineY 를 마지막 줄로 삼아 위로 쌓아 그림
        const drawStyledCentered = (styledLines, centerX, baselineY) => {
            if (!styledLines.length) return;
            ctx.letterSpacing = '0px';
            ctx.textBaseline = 'bottom';
            ctx.textAlign = 'left';
            let by = baselineY;
            for (let i = styledLines.length - 1; i >= 0; i--) {
                const line = styledLines[i];
                let lx = centerX - line.totalWidth / 2;
                for (const chunk of line.chunks) {
                    ctx.font = chunk.font;
                    ctx.fillStyle = chunk.isHighlight ? hlColor : textColor;
                    ctx.fillText(chunk.text, lx, by);
                    lx += chunk.width;
                }
                if (i > 0) by -= lineH(styledLines[i - 1]);
            }
        };

        if (topText && periodText) {
            const titleLines = wrapStyledText(ctx, topText, titleMaxW, TOP_SIZE, false, fonts);
            drawStyledCentered(titleLines, W / 2, headerH - 40);
            const periodLines = wrapStyledText(ctx, periodText, titleMaxW, TOP_SIZE, false, fonts);
            drawStyledCentered(periodLines, W / 2, headerH - 12);
        } else if (topText) {
            const titleLines = wrapStyledText(ctx, topText, titleMaxW, TOP_SIZE, false, fonts);
            drawStyledCentered(titleLines, W / 2, headerH - 12);
        } else {
            const periodLines = wrapStyledText(ctx, periodText, titleMaxW, TOP_SIZE, false, fonts);
            drawStyledCentered(periodLines, W / 2, headerH - 12);
        }
    }

    // 기간 우측 텍스트 (헤더 우측 끝, 기간 높이에 우측 정렬)
    if (bandH > 0 && periodNote) {
        const NOTE_SIZE = 18;
        const noteLines = wrapStyledText(ctx, periodNote, W - MARGIN * 2, NOTE_SIZE, false, fonts);
        if (noteLines.length && noteLines[0].chunks.length) {
            const noteLine = noteLines[0];
            let nx = W - MARGIN;
            ctx.letterSpacing = '0px';
            ctx.textBaseline = 'bottom';
            ctx.textAlign = 'left';
            for (let i = noteLine.chunks.length - 1; i >= 0; i--) {
                const chunk = noteLine.chunks[i];
                ctx.font = chunk.font;
                ctx.fillStyle = chunk.isHighlight ? hlColor : textColor;
                nx -= chunk.width;
                ctx.fillText(chunk.text, nx, headerH - 12);
            }
        }
    }


    return canvas;
}


function drawSection(ctx, sec, x, startY, colW, themeColor, numColor, fonts, hlColor = '#FFEB3B', itemHlColor = '#FF0000', labelBoxColor = '#000000') {
    let y = startY;

    // 이벤트 박스 모서리 둥글게: 흰 카드는 4면 둥글게(호출부에서 처리), 제목 박스는 위쪽만 둥글게
    const hasItems = sec.items.length > 0;
    // roundRect 반경 배열 순서: [좌상, 우상, 우하, 좌하]
    const strokeRounded = (px, py, pw, ph, corners) => {
        const r = corners.map(c => Math.max(0, Math.min(c, pw / 2, ph / 2)));
        ctx.beginPath(); ctx.roundRect(px, py, pw, ph, r); ctx.stroke();
    };
    const fillRounded = (px, py, pw, ph, corners) => {
        const r = corners.map(c => Math.max(0, Math.min(c, pw / 2, ph / 2)));
        ctx.beginPath(); ctx.roundRect(px, py, pw, ph, r); ctx.fill();
    };
    // 헤더 바 모서리: 위쪽 둥글게, 아래쪽은 아이템이 이어지면 각지게
    const hdrCorners = (rr) => [rr, rr, hasItems ? 0 : rr, hasItems ? 0 : rr];

    // 섹션 헤더 바 — 흰 카드 안쪽으로 HEADER_INSET 만큼 들여 그려 둘레에 흰 테두리가 보이게.
    // 아이템이 이어지면 아래쪽은 아이템 영역과 맞닿도록 여백 없이 각지게 유지.
    if (sec.title) {
        const HEADER_H = (sec.titleSize || 24) + 16;
        const style = sec.headerStyle || 'filled';
        const bx = x + HEADER_INSET;
        const by = y + HEADER_INSET;
        const bw = colW - HEADER_INSET * 2;
        const bh = HEADER_H - HEADER_INSET - (hasItems ? 0 : HEADER_INSET);
        const cardR = sectionCardRadius(sec);   // 카드와 같은 기준이어야 여백이 균일
        const bCorners = hdrCorners(cardR - HEADER_INSET);
        if (style === 'filled') {
            ctx.fillStyle = themeColor;
            fillRounded(bx, by, bw, bh, bCorners);
            ctx.fillStyle = '#ffffff';
        } else {
            ctx.fillStyle = '#f8f8f8';
            fillRounded(bx, by, bw, bh, bCorners);
            ctx.strokeStyle = themeColor;
            ctx.lineWidth = 3;
            strokeRounded(bx + 1.5, by + 1.5, bw - 3, bh - 3, hdrCorners(cardR - HEADER_INSET - 1.5));
            ctx.fillStyle = themeColor;
        }
        const _baseSize = sec.titleSize || 24;
        const _baseColor = style === 'filled' ? '#ffffff' : themeColor;
        const _hlColor   = style === 'filled' ? hlColor : numColor;
        const _titleLines = wrapStyledText(ctx, sec.title, bw - 16, _baseSize, true, fonts);
        const _line = _titleLines[0];
        if (_line && _line.chunks.length > 0) {
            const _midY = by + bh / 2;
            let _lx = bx + bw / 2 - _line.totalWidth / 2;
            ctx.letterSpacing = '0px';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            for (const chunk of _line.chunks) {
                ctx.font = chunk.font;
                ctx.fillStyle = chunk.isHighlight ? _hlColor : _baseColor;
                ctx.fillText(chunk.text, _lx, _midY);
                _lx += chunk.width;
            }
        }
        y += HEADER_H;
    }

    // 아이템 행 — 항목별 가로 칸(전체폭/2열/3열) 패킹: 같은 폭 연속 항목을 한 행에 N칸으로
    const bs = sec.bodySize || 20, ns = sec.numSize || 35, ts = sec.titleSize || 24;
    const itemRows = packItemRows(sec.items);
    const grids = sectionTierGrids(ctx, sec, colW, fonts);   // 섹션 전체 단위박스·금액 일직선 정렬용
    for (let r = 0; r < itemRows.length; r++) {
        const grp = itemRows[r];
        const widths = itemColWidths(colW, grp.cols);
        const thisSub = !!grp.items[0]?.isSublabel;
        const nextSub = (r + 1 < itemRows.length) && !!itemRows[r + 1].items[0]?.isSublabel;
        const isLastRow = r === itemRows.length - 1;
        const cellGrid = c => grids.get(`${grp.cols}:${c}`) || null;
        // 행 높이 = 그룹 내 항목들의 자연 높이 최대값(각자 칸 폭 기준)
        const geos = grp.items.map((it, c) => itemRowGeometry(ctx, it, widths[c], fonts, bs, ns, null, cellGrid(c), ts));
        const rowH = Math.max(0, ...geos.map(g => g.rowH)) + sublabelBottomPad(grp, isLastRow);
        // 같은 행에서 가격 2개 이상 항목들의 가격 블록 높이 최대값(하단 정렬됨) → 단일 금액 항목을 이 블록 중앙에 맞추기 위해 전달
        const peerPriceH = Math.max(0, ...geos.filter(g => g.L && g.L.tiers && g.L.tiers.length >= 2).map(g => g.L.priceTotalH));
        // 각 칸 그리기(행 높이로 정렬, 자체 구분선은 그리지 않음 → 행 단위로 아래에서 처리)
        let cx = x;
        for (let c = 0; c < grp.items.length; c++) {
            // isLast: 구분선은 아래에서 행 단위로 그리므로 쓰이지 않고, 소제목이 섹션 맨 아래인지 판정에 쓰인다
            drawItemRow(ctx, grp.items[c], cx, y, widths[c], themeColor, numColor, itemHlColor, '#ffffff', fonts, isLastRow, bs, ns, labelBoxColor, rowH, false, peerPriceH, cellGrid(c), ts);
            cx += widths[c];
        }
        // 칸 사이 세로 구분선
        if (!thisSub && grp.items.length > 1 && beginItemDivider(ctx, themeColor)) {
            let vx = x;
            for (let c = 0; c < grp.items.length - 1; c++) {
                vx += widths[c];
                ctx.beginPath(); ctx.moveTo(vx, y + 8); ctx.lineTo(vx, y + rowH - 8); ctx.stroke();
            }
            endItemDivider(ctx);
        }
        // 행 사이 가로 구분선 (마지막 행·소제목 인접 제외)
        if (!thisSub && !isLastRow && !nextSub && beginItemDivider(ctx, themeColor)) {
            ctx.beginPath(); ctx.moveTo(x + 18, y + rowH); ctx.lineTo(x + colW - 18, y + rowH); ctx.stroke();
            endItemDivider(ctx);
        }
        y += rowH;
    }

    return y;
}

/* 소제목 줄바꿈 레이아웃 — 측정(itemRowGeometry)·그리기(drawItemRow)가 공유해 높이를 일치시킴.
 * wrapStyledText가 수동 줄바꿈(\n)과 폭 초과 자동 줄바꿈을 모두 처리. 단일 줄이면 기존 높이 유지. */
function sublabelLayout(ctx, item, colW, fonts, bodySize, titleSize = 24) {
    const PAD_X = 18;
    const base = Math.round(bodySize * 1.1);
    const lines = wrapStyledText(ctx, item.itemName, colW - PAD_X * 2, base, true, fonts);
    // 각 줄 높이 = 그 줄에서 가장 큰 글자 크기 × 1.28 → 확대/축소 서식에 행간이 비례
    const lineHeights = lines.map(line => {
        const maxSize = line.chunks.length ? Math.max(...line.chunks.map(c => c.size || base)) : base;
        return Math.round(maxSize * 1.28);
    });
    const contentH = lineHeights.reduce((a, b) => a + b, 0);
    // 기본 높이는 제목 박스와 동일 — 제목 박스도 (제목크기+16)에서 HEADER_INSET 만큼 줄여 그린다.
    // 여러 줄이거나 확대 서식으로 내용이 커지면 최소 여백을 두고 그만큼 늘어난다.
    const VPAD = Math.round(bodySize * 0.2);
    const rowH = Math.max(titleBarHeight(titleSize), contentH + VPAD * 2);
    return { lines, lineHeights, contentH, rowH, PAD_X };
}

/* 비고(작은 글씨) 줄바꿈·서식 레이아웃 — 측정(itemRowGeometry)·그리기(drawItemRow)가 공유해 높이 일치.
 * wrapStyledText로 서식(강조·확대·축소·굵게) + 수동 \n + 폭 초과 자동 줄바꿈 처리. */
function noteLayout(ctx, note, colW, noteSize, fonts) {
    const PAD_X = 18;
    const lines = wrapStyledText(ctx, note, colW - PAD_X * 2, noteSize, false, fonts);
    // 각 줄 높이 = 그 줄에서 가장 큰 글자 크기 × 1.1 → 확대 서식 시 행(높이)이 같이 커져 실선도 내려감
    const lineHeights = lines.map(line => {
        const maxSize = line.chunks.length ? Math.max(...line.chunks.map(c => c.size || noteSize)) : noteSize;
        return maxSize * 1.1;
    });
    const H = lineHeights.reduce((a, b) => a + b, 0) + 2;
    return { lines, lineHeights, H };
}

function drawItemRow(ctx, item, x, startY, colW, themeColor, numColor, itemHlColor, rowBg, fonts, isLast = false, bodySize = 20, numSize = 35, labelBoxColor = '#000000', rowHOverride = null, drawBottomDivider = true, peerPriceH = 0, sectionGrid = null, titleSize = 24) {
    const PAD_X = 18, PAD_Y = 12;
    const NAME_SIZE = bodySize, PRICE_SIZE = 28, NOTE_SIZE = Math.round(bodySize * 0.85);  // 비고 (본문 크기 연동)
    const getLineH = (line) => line.chunks.length ? Math.max(...line.chunks.map(c => c.size || NAME_SIZE)) : NAME_SIZE;

    // 소제목 행 (줄바꿈 지원 — 수동 \n·폭 초과 자동 줄바꿈)
    if (item.isSublabel) {
        const sl = sublabelLayout(ctx, item, colW, fonts, bodySize, titleSize);
        const SL_H = rowHOverride || sl.rowH;   // 소제목 박스 높이 (줄 수·본문 크기 연동)
        // 제목 박스처럼 좌우를 HEADER_INSET 만큼 들여 그려 양옆에 흰 여백이 보이게.
        // 섹션 맨 아래 항목이면 제목 박스가 아이템 없이 홀로 놓일 때와 같은 처리를 한다 —
        // 아래쪽도 들여 흰 여백을 남기고 하단 두 모서리를 카드 모서리 반경에 맞춰 둥글게.
        // (그 외에는 위아래로 내용이 이어지므로 각진 띠 유지)
        const slX = x + HEADER_INSET, slW = colW - HEADER_INSET * 2;
        const slH = SL_H - (isLast ? HEADER_INSET : 0);
        ctx.fillStyle = hexToRgba(themeColor, 0.13);
        if (isLast) {
            // 카드와 같은 기준(제목 박스 높이)으로 반경을 잡아야 아래 모서리 여백이 균일해진다
            const r = Math.max(0, Math.min(cardRadiusForBar(titleBarHeight(titleSize)) - HEADER_INSET, slW / 2, slH / 2));
            ctx.beginPath(); ctx.roundRect(slX, startY, slW, slH, [0, 0, r, r]); ctx.fill();
        } else {
            ctx.fillRect(slX, startY, slW, slH);
        }
        ctx.letterSpacing = '0px';
        ctx.textBaseline = 'middle';
        // 여러 줄을 세로 중앙 배치(줄별 높이 반영), 각 줄은 가로 중앙 정렬(넘치면 좌측 패딩)
        let ly = startY + (slH - sl.contentH) / 2;
        sl.lines.forEach((line, li) => {
            let cx = x + Math.max(sl.PAD_X, (colW - line.totalWidth) / 2);
            const cy = ly + sl.lineHeights[li] / 2;
            for (const chunk of line.chunks) {
                ctx.font = chunk.font;
                ctx.fillStyle = chunk.isHighlight ? itemHlColor : hexToRgba(themeColor, 0.85);
                ctx.textAlign = 'left';
                ctx.fillText(chunk.text, cx, cy);
                cx += chunk.width;
            }
            ly += sl.lineHeights[li];
        });
        return startY + SL_H;
    }

    // 레이아웃·높이 판정 — 측정과 동일 로직(itemRowGeometry) 공유로 측정/그리기 파리티 보장
    const geo = itemRowGeometry(ctx, item, colW, fonts, bodySize, numSize, rowHOverride, sectionGrid, titleSize);
    const { L, rowH, noteH } = geo;
    const { tiers, isStacked, nameLines, nameBlockH, tierRows, priceTotalH } = L;
    const lineHeights = nameLines.map(getLineH);
    const hasNote = !!item.note;
    const PRICE_TIER_H = priceTierH(numSize);
    const PRICE_ROW_GAP = priceRowGap(numSize);
    const PRICE_GAP = 1;
    const priceCenterY = startY + geo.priceCenterOff;
    const nameStartY = startY + geo.nameStartOff;

    // 배경
    ctx.fillStyle = rowBg;
    ctx.fillRect(x, startY, colW, rowH);

    // 구분선 (양쪽 18px 여백, 마지막 항목 제외). 다열 행은 drawSection이 행 단위로 그림 → drawBottomDivider=false
    if (drawBottomDivider && !isLast && beginItemDivider(ctx, themeColor)) {
        ctx.beginPath();
        ctx.moveTo(x + 18, startY + rowH);
        ctx.lineTo(x + colW - 18, startY + rowH);
        ctx.stroke();
        endItemDivider(ctx);
    }

    // 항목명
    ctx.letterSpacing = '0px';
    let ny = nameStartY;
    for (let li = 0; li < nameLines.length; li++) {
        const line = nameLines[li];
        let lx = x + PAD_X;
        for (const chunk of line.chunks) {
            ctx.font = chunk.font;
            ctx.fillStyle = chunk.isHighlight ? itemHlColor : '#1a1a1a';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(chunk.text, lx, ny);
            lx += chunk.width;
        }
        if (li + 1 < nameLines.length) ny += (lineHeights[li] + lineHeights[li + 1]) / 2 * ITEM_LINE_HEIGHT;
    }

    // 가격 티어
    const priceRightX = x + colW - PAD_X;
    const botPad = stackPadY(numSize);   // 두 모드 공통 좁은 상하 여백
    const priceBottom = startY + (rowH - noteH) - botPad;   // 하단 정렬 기준선
    // 같은 행 다중가격 블록(하단 정렬)의 세로 중앙. peer 없으면 행 중앙 → 단일 금액을 여기에 맞춤.
    const peerCenterY = peerPriceH > 0 ? priceBottom - peerPriceH / 2 : (startY + (rowH - noteH) / 2);
    if (L.sideVerticalTiers && tierRows.length > 0) {
        // 나란히 세로 티어(2개+): 하단 정렬·우측 정렬 → 칸끼리 마지막 가격 줄이 바닥에 맞음
        const priceTopY = Math.max(startY + botPad, priceBottom - priceTotalH);
        drawPriceTierRows(ctx, tierRows, priceRightX, priceTopY, themeColor, numColor, fonts, numSize, PRICE_TIER_H, PRICE_ROW_GAP, labelBoxColor, colW - PAD_X * 2, sectionGrid);
    } else if (isStacked && tierRows.length > 0) {
        // 아래로 모드. 다열: 가격 2개+ 하단 정렬, 단일 금액은 타 항목 가격 블록 중앙에 맞춤. 1열은 이름 바로 아래.
        const belowName = startY + botPad + Math.ceil(nameBlockH) + PRICE_GAP;
        let priceTopY = belowName;
        if (itemColCount(item) >= 2) {
            if (tiers.length >= 2) priceTopY = Math.max(belowName, priceBottom - priceTotalH);            // 가격 2개+ → 하단 정렬
            else if (peerPriceH > 0) priceTopY = Math.max(belowName, peerCenterY - priceTotalH / 2);      // 단일 + 2가격 peer 있음 → peer 블록 중앙
            else priceTopY = Math.max(belowName, priceBottom - priceTotalH);                              // 단일 + peer 없음(전부 단일) → 하단 정렬
        }
        drawPriceTierRows(ctx, tierRows, priceRightX, priceTopY, themeColor, numColor, fonts, numSize, PRICE_TIER_H, PRICE_ROW_GAP, labelBoxColor, colW - PAD_X * 2, sectionGrid);
    } else {
        // 나란히 단일 금액: 다열이고 다중가격 peer가 있으면 그 블록 중앙에 맞춤(없으면 기존 행 중앙)
        const cy = (itemColCount(item) >= 2 && peerPriceH > 0) ? peerCenterY : priceCenterY;
        drawPriceTiers(ctx, item, priceRightX, cy, themeColor, numColor, PRICE_SIZE, fonts, numSize, labelBoxColor, sectionGrid);
    }

    // 비고 텍스트 (우하단 작은 글씨) — 줄바꿈·서식(강조·확대·축소·굵게) 지원, 우측 정렬
    if (hasNote) {
        const nl = noteLayout(ctx, item.note, colW, NOTE_SIZE, fonts);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.letterSpacing = '0px';
        let ny = startY + rowH - noteH + 1;
        nl.lines.forEach((line, i) => {
            let lx = x + colW - PAD_X - line.totalWidth;   // 우측 정렬 시작 x
            for (const chunk of line.chunks) {
                ctx.font = chunk.font;
                ctx.fillStyle = chunk.isHighlight ? itemHlColor : '#666666';
                ctx.fillText(chunk.text, lx, ny);
                lx += chunk.width;
            }
            ny += nl.lineHeights[i];
        });
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
    const NUM_SIZE = numSize, UNIT_SIZE = Math.round(numSize * 0.49), CHIP_LABEL_SIZE = Math.round(numSize * 0.37);  // 라벨 칩 (금액 크기 연동)
    let w = 0;
    if (tier.price) {
        const tokens = tokenizePriceText(tier.price);
        for (let t = 0; t < tokens.length; t++) {
            const tok = tokens[t];
            if (tok.type === 'num') { ctx.letterSpacing = '-1.5px'; ctx.font = `700 ${NUM_SIZE}px ${fonts.cheoeumcheoreom}`; }
            else { ctx.letterSpacing = '0px'; ctx.font = `400 ${UNIT_SIZE}px ${fonts.main}`; }
            w += ctx.measureText(tok.text).width;
            if (t < tokens.length - 1 && tokens[t + 1].type !== tok.type) w += 2;
        }
        if (tier.label) w += 10;
    }
    if (tier.label) { ctx.font = `500 ${CHIP_LABEL_SIZE}px ${fonts.medium}`; w += ctx.measureText(tier.label).width + 18; }
    return w;
}

/* 금액(숫자+단위)만의 폭 — 단위박스 제외. 세로 스택 시 가격 우측 정렬·단위박스 통일 계산용. */
function measurePriceTokensWidth(ctx, priceStr, numSize, fonts) {
    if (!priceStr) return 0;
    const NUM_SIZE = numSize, UNIT_SIZE = Math.round(numSize * 0.49);
    const tokens = tokenizePriceText(priceStr);
    let w = 0;
    for (let t = 0; t < tokens.length; t++) {
        const tok = tokens[t];
        if (tok.type === 'num') { ctx.letterSpacing = '-1.5px'; ctx.font = `700 ${NUM_SIZE}px ${fonts.cheoeumcheoreom}`; }
        else { ctx.letterSpacing = '0px'; ctx.font = `400 ${UNIT_SIZE}px ${fonts.main}`; }
        w += ctx.measureText(tok.text).width;
        if (t < tokens.length - 1 && tokens[t + 1].type !== tok.type) w += 2;
    }
    return w;
}
/* 단위박스(라벨 칩) 폭 — 라벨 좌우 패딩 18 포함. */
function measureChipWidth(ctx, label, numSize, fonts) {
    if (!label) return 0;
    const CHIP_LABEL_SIZE = Math.round(numSize * 0.37);
    ctx.font = `500 ${CHIP_LABEL_SIZE}px ${fonts.medium}`;
    return ctx.measureText(label).width + 18;
}

function measurePriceTiersWidth(ctx, tiers, numSize, fonts) {
    if (!tiers.length) return 0;
    const TIER_GAP = 14;
    return tiers.reduce((sum, t, i) => sum + measureSingleTierWidth(ctx, t, numSize, fonts) + (i < tiers.length - 1 ? TIER_GAP : 0), 0);
}

/* 여러 줄로 놓인 가격 티어를 '우측 기준 열 그리드'로 정렬하기 위한 열 폭 계산.
 * 열 번호 j 는 오른쪽에서 0부터. 한 열 = (그 열에서 가장 넓은 단위박스) + 10 + (가장 긴 금액).
 * → 줄마다 티어 수·숫자 폭이 달라도 금액 우측과 단위박스 우측이 세로로 일직선에 놓인다.
 * 반환: { cols: [{ chipW, priceW, totalW }], totalW } (totalW 는 열 사이 간격 포함한 전체 폭) */
function computeTierGrid(ctx, tierRows, numSize, fonts) {
    const TIER_GAP = 14;
    const nCols = Math.max(...tierRows.map(r => r.length));
    const cols = Array.from({ length: nCols }, () => ({ chipW: 0, priceW: 0, totalW: 0 }));
    for (const row of tierRows) {
        for (let i = 0; i < row.length; i++) {
            const col = cols[row.length - 1 - i];   // 오른쪽에서 센 열 번호
            col.chipW = Math.max(col.chipW, measureChipWidth(ctx, row[i].label, numSize, fonts));
            col.priceW = Math.max(col.priceW, measurePriceTokensWidth(ctx, row[i].price, numSize, fonts));
        }
    }
    let totalW = 0;
    cols.forEach((col, j) => {
        col.totalW = col.chipW + (col.chipW > 0 ? 10 : 0) + col.priceW;
        totalW += col.totalW + (j > 0 ? TIER_GAP : 0);
    });
    return { cols, totalW };
}

/* 그리드에서 티어 n개짜리 한 줄이 차지하는 폭(오른쪽에서 n개 열 + 그 사이 간격). */
function tierRowWidthInGrid(grid, n) {
    const TIER_GAP = 14;
    let w = 0;
    for (let j = 0; j < n && j < grid.cols.length; j++) w += grid.cols[j].totalW + (j > 0 ? TIER_GAP : 0);
    return w;
}

function packTierRows(ctx, tiers, maxW, numSize, fonts) {
    // 4개는 2×2 가 보기 좋지만, 좁은 칸(3열 등)에서는 넘쳐 잘리므로 들어갈 때만 적용
    if (tiers.length === 4) {
        const twoByTwo = [tiers.slice(0, 2), tiers.slice(2, 4)];
        if (computeTierGrid(ctx, twoByTwo, numSize, fonts).totalW <= maxW) return twoByTwo;
        // 안 들어가면 아래 일반 패킹으로 → 폭에 맞춰 한 줄에 하나씩 쌓임
    }
    // 역방향으로 채워서 뒤집으면 첫 행이 적고 마지막 행이 많은 하단 집중 배치가 됨 (5개 → 2+3)
    // 폭 판정은 실제 그리기와 같은 열 그리드 기준 — 단위박스 우측 정렬로 넓어진 폭까지 반영해 넘침 방지.
    const reversed = [...tiers].reverse();
    const rows = [[]];
    for (const tier of reversed) {
        const cur = rows[rows.length - 1];
        if (cur.length === 0) { cur.push(tier); continue; }
        cur.push(tier);
        const grid = computeTierGrid(ctx, rows.map(r => [...r].reverse()), numSize, fonts);
        if (grid.totalW > maxW) { cur.pop(); rows.push([tier]); }
    }
    return rows.filter(r => r.length > 0).reverse().map(row => row.reverse());
}

function tokenizePriceText(str) {
    const tokens = [], s = String(str || '');
    let i = 0;
    while (i < s.length) {
        const isNum = /[\d,\.]/.test(s[i]);
        let j = i + 1;
        while (j < s.length && /[\d,\.]/.test(s[j]) === isNum) j++;
        tokens.push({ type: isNum ? 'num' : 'unit', text: s.slice(i, j) });
        i = j;
    }
    return tokens;
}

/* 한 행의 가격 티어들을 rightX 기준 우→좌로 그림(숫자 시각 중앙을 centerY에 정렬).
 * 단일행(drawPriceTiers)·다행(drawPriceTierRows) 양쪽이 공유.
 * grid(computeTierGrid 결과)를 주면 티어를 열 그리드에 맞춰 배치 — 줄이 달라도 금액·단위박스가 우측 정렬로 일직선. */
function drawTierRow(ctx, tiers, rightX, centerY, numColor, fonts, numSize, labelBoxColor, grid = null) {
    const NUM_SIZE = numSize, UNIT_SIZE = Math.round(numSize * 0.49), CHIP_LABEL_SIZE = Math.round(numSize * 0.37);  // 라벨 칩 (금액 크기 연동)
    const CHIP_H = Math.round(CHIP_LABEL_SIZE * 2);
    const TIER_GAP = 14;

    // 숫자 폰트 메트릭으로 baseline 계산 → 숫자 시각적 중앙을 centerY에 정렬
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${NUM_SIZE}px ${fonts.cheoeumcheoreom}`;
    const _nm = ctx.measureText('0');
    const baselineY = centerY + (_nm.actualBoundingBoxAscent - _nm.actualBoundingBoxDescent) / 2;

    // 열 그리드의 각 열 우측 경계(오른쪽에서 0번). 금액은 여기에 우측 정렬, 단위박스는 열의 최대 금액폭만큼 더 왼쪽.
    if (grid && grid.cols.length < tiers.length) grid = null;   // 이 줄을 못 담는 그리드는 무시(안전장치)
    let colRight = null;
    if (grid) {
        colRight = [];
        let r = rightX;
        for (let j = 0; j < grid.cols.length; j++) { colRight[j] = r; r -= grid.cols[j].totalW + TIER_GAP; }
    }

    let x = rightX;
    ctx.letterSpacing = '-1.5px';
    for (let i = tiers.length - 1; i >= 0; i--) {
        const tier = tiers[i];
        const col = grid ? grid.cols[tiers.length - 1 - i] : null;
        if (col) x = colRight[tiers.length - 1 - i];
        if (tier.price) {
            const tokens = tokenizePriceText(tier.price);
            let px = x;
            for (let t = tokens.length - 1; t >= 0; t--) {
                const tok = tokens[t];
                const isNum = tok.type === 'num';
                ctx.letterSpacing = isNum ? '-1.5px' : '0px';
                ctx.font = isNum ? `700 ${NUM_SIZE}px ${fonts.cheoeumcheoreom}` : `400 ${UNIT_SIZE}px ${fonts.main}`;
                ctx.fillStyle = isNum ? numColor : '#111111';
                ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
                const tw = ctx.measureText(tok.text).width;
                ctx.fillText(tok.text, px, baselineY); px -= tw;
                if (t > 0 && tokens[t - 1].type !== tok.type) px -= 2;
            }
            x = px - (tier.label ? 10 : 0);
        }
        if (tier.label) {
            ctx.font = `500 ${CHIP_LABEL_SIZE}px ${fonts.medium}`;
            const lw = ctx.measureText(tier.label).width;
            const chipW = lw + 18;
            // 그리드 정렬 시 단위박스 우측 경계는 열의 최대 금액폭 기준으로 통일. 그 외엔 금액 바로 왼쪽(x).
            const chipRightEdge = col ? colRight[tiers.length - 1 - i] - col.priceW - 10 : x;
            const chipX = chipRightEdge - chipW;
            ctx.fillStyle = labelBoxColor;
            roundRect(ctx, chipX, centerY - CHIP_H / 2, chipW, CHIP_H, CHIP_H / 2);
            ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(tier.label, chipX + chipW / 2, centerY);
            x = chipX - (i > 0 ? TIER_GAP : 0);
        } else if (i > 0) {
            x -= TIER_GAP;
        }
    }
}

function drawPriceTiers(ctx, item, rightX, centerY, themeColor, numColor, fontSize, fonts, numSize = 35, labelBoxColor = '#000000', sectionGrid = null) {
    const tiers = buildTiers(item);
    if (!tiers.length) return;
    drawTierRow(ctx, tiers, rightX, centerY, numColor, fonts, numSize, labelBoxColor, sectionGrid);
}

function drawPriceTierRows(ctx, tierRows, rightX, topY, themeColor, numColor, fonts, numSize, TIER_H = 35, ROW_GAP = 6, labelBoxColor = '#000000', maxW = Infinity, sectionGrid = null) {
    // 가격이 위아래 여러 줄로 놓이면 열 그리드로 정렬 — 숫자 폭이 달라도 금액·단위박스가 우측 기준 일직선.
    // 섹션 그리드가 주어지면(항목끼리도 일직선) 그것을 우선 사용. 없으면 이 항목만으로 그리드를 만든다.
    // 그리드 폭이 칸 폭을 넘으면(4개 2×2 강제 등) 정렬을 포기하고 기존 우측 흐름 배치로 폴백.
    let grid = sectionGrid;
    if (!grid && tierRows.length > 1) {
        const g = computeTierGrid(ctx, tierRows, numSize, fonts);
        if (g.totalW <= maxW) grid = g;
    }
    for (let ri = 0; ri < tierRows.length; ri++) {
        const centerY = topY + ri * (TIER_H + ROW_GAP) + TIER_H / 2;
        drawTierRow(ctx, tierRows[ri], rightX, centerY, numColor, fonts, numSize, labelBoxColor, grid);
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
                _node: node,          // 미리보기 하이라이트용 — 대응하는 섹션 헤더 DOM
                items: []
            };
        } else if (node.classList.contains('item-row')) {
            if (!currentSection) {
                currentSection = { title: '', titleSize: 24, bodySize: 20, numSize: 35, isFullWidth: false, items: [] };
            }
            currentSection.items.push({
                itemName: node.querySelector('.item-name')?.value || '',
                isSublabel: node.querySelector('.item-sublabel')?.checked || false,
                cols: parseInt(node.dataset.cols, 10) || 1,
                priceLayout: node.dataset.priceLayout || '',
                prices: readPriceSlots(node),
                note: node.querySelector('.item-note-input')?.value || ''
            });
        }
    }

    flushSection();
    flushSplit();

    return pages.filter(p => p.rows.length > 0);
}

/* 컬럼 구분이 없어 우측 컬럼이 빈 split 행은 좌측 섹션들을 전체폭 1열로 펼친다.
 * (명시적 컬럼 구분이 있을 때만 2열 — '컬럼 구분 없으면 1열 전체 너비' 규칙) */
function expandEmptyRightToFull(page) {
    const rows = [];
    for (const row of page.rows) {
        if (row.type === 'split' && row.right.length === 0) {
            row.left.forEach(sec => rows.push({ type: 'full', section: sec }));
        } else {
            rows.push(row);
        }
    }
    page.rows = rows;
}

/* 높이 배열을 좌/우 두 그룹으로 나눠 합 차이를 최소화하는 최적 분할(부분합 DP).
 * 반환: 각 인덱스가 좌측(true)/우측(false)인지. 동률이면 좌측에 더 많이. */
function partitionByHeight(heights) {
    const n = heights.length;
    const ints = heights.map(h => Math.max(1, Math.round(h)));
    const total = ints.reduce((a, b) => a + b, 0);
    // 안전장치: 합이 과도하면(이론상 페이지 초과) 그리디로 대체
    if (total > 40000) {
        const order = ints.map((h, i) => ({ h, i })).sort((a, b) => b.h - a.h);
        let lH = 0, rH = 0; const inLeft = new Array(n).fill(false);
        for (const o of order) { if (lH <= rH) { inLeft[o.i] = true; lH += o.h; } else { rH += o.h; } }
        return inLeft;
    }
    // 0/1 부분합 DP (역추적 가능하도록 단계별 테이블 보관)
    const reach = Array.from({ length: n + 1 }, () => new Uint8Array(total + 1));
    reach[0][0] = 1;
    for (let i = 1; i <= n; i++) {
        const hi = ints[i - 1];
        const prev = reach[i - 1], cur = reach[i];
        for (let s = 0; s <= total; s++) {
            if (prev[s]) { cur[s] = 1; if (s + hi <= total) cur[s + hi] = 1; }
        }
    }
    // total/2 이하 중 도달 가능한 최대 합 = 좌측 합 (좌측이 ≥ 우측이 되도록)
    const half = Math.floor(total / 2);
    let bestS = 0;
    for (let s = total - half; s >= 0; s--) { if (reach[n][s]) { bestS = s; break; } }
    // 역추적: 어떤 섹션이 좌측인지.
    // 좌/우 어느 쪽에 넣어도 최적 높이합(bestS)이 유지되는 갈림길에서는
    // 섹션 '개수'가 더 적은 쪽에 배정해 시각적 균형(높이 같아도 한쪽만 빽빽해지는 현상)을 보완.
    const inLeft = new Array(n).fill(false);
    let s = bestS, leftCount = 0, rightCount = 0;
    for (let i = n; i >= 1; i--) {
        const hi = ints[i - 1];
        const canLeft = s - hi >= 0 && reach[i - 1][s - hi];
        const canRight = reach[i - 1][s];
        const goLeft = (canLeft && canRight) ? leftCount <= rightCount : canLeft;
        if (goLeft) { inLeft[i - 1] = true; s -= hi; leftCount++; }
        else rightCount++;
    }
    return inLeft;
}

/* split 행 하나를 높이 기준 최적 분할 (구분선이 없어 한쪽에 몰린 경우 사용). */
function balanceRow(row) {
    const ctx = getMeasureCtx();
    const { fonts } = CONFIG;
    const twoColW = computeTwoColW();
    const all = [...row.left, ...row.right];
    if (all.length < 2) { row.left = all; row.right = []; return; }
    const heights = all.map(s => measureSection(ctx, s, twoColW, fonts) + currentSectionGap());
    const inLeft = partitionByHeight(heights);
    const L = [], R = [];
    all.forEach((sec, i) => (inLeft[i] ? L : R).push(sec));   // 컬럼 내부 순서 유지
    if (!L.length) { L.push(R.shift()); }                    // 빈 컬럼 방지
    else if (!R.length) { R.push(L.pop()); }
    row.left = L;
    row.right = R;
}

/* DOM 노드(섹션 헤더 + 항목들)로부터 측정용 섹션 객체 구성. */
function sectionFromDom(wrapperNode, itemNodes) {
    const sec = wrapperNode ? {
        title: wrapperNode.querySelector('.section-title-input')?.value.trim() || '',
        titleSize: parseInt(wrapperNode.querySelector('.js-title-size-display')?.textContent) || 24,
        bodySize: parseInt(wrapperNode.querySelector('.js-body-size-display')?.textContent) || 20,
        numSize: parseInt(wrapperNode.querySelector('.js-num-size-display')?.textContent) || 35,
        isFullWidth: wrapperNode.dataset.fullWidth === 'true',
        items: []
    } : { title: '', titleSize: 24, bodySize: 20, numSize: 35, isFullWidth: false, items: [] };
    for (const node of itemNodes) {
        sec.items.push({
            itemName: node.querySelector('.item-name')?.value || '',
            isSublabel: node.querySelector('.item-sublabel')?.checked || false,
            cols: parseInt(node.dataset.cols, 10) || 1,
            priceLayout: node.dataset.priceLayout || '',
            prices: readPriceSlots(node),
            note: node.querySelector('.item-note-input')?.value || ''
        });
    }
    return sec;
}

/* '좌우 균등 맞춤' 실제 정리: 설정 패널의 섹션 DOM과 컬럼 구분선을
 * 높이 균형 분할 결과대로 좌/우로 실제 이동시킨다.
 * (전체폭 섹션은 균형 대상에서 제외하고 상단에 모음) */
/* itemsContainer 를 섹션 블록 단위로 수집. 각 블록 = { wrapper(섹션헤더|null), items[], isFull }.
 * 구분선은 제외(블록 경계 역할). 섹션 없이 앞선 항목들은 wrapper=null 블록으로. */
function collectSectionBlocks() {
    const container = document.getElementById('itemsContainer');
    const children = Array.from(container.children).filter(n => !n.classList.contains('items-empty-hint'));
    const blocks = []; let cur = null;
    for (const node of children) {
        if (node.classList.contains('column-break-wrapper')) { cur = null; continue; }
        if (node.classList.contains('section-title-wrapper')) {
            cur = { wrapper: node, items: [], isFull: node.dataset.fullWidth === 'true' };
            blocks.push(cur);
        } else if (node.classList.contains('item-row')) {
            if (!cur) { cur = { wrapper: null, items: [], isFull: false }; blocks.push(cur); }
            cur.items.push(node);
        }
    }
    return blocks;
}

function reorderDomBalanced() {
    const container = document.getElementById('itemsContainer');

    // 1) 섹션 블록 수집
    const blocks = collectSectionBlocks();
    const twoCol = blocks.filter(b => !b.isFull);
    const full = blocks.filter(b => b.isFull);
    if (twoCol.length < 2) return false;   // 나눌 게 없음

    // 2) 높이 측정 → 최적 분할
    const ctx = getMeasureCtx(); const { fonts } = CONFIG; const colW = computeTwoColW();
    const heights = twoCol.map(b => measureSection(ctx, sectionFromDom(b.wrapper, b.items), colW, fonts) + currentSectionGap());
    const inLeft = partitionByHeight(heights);
    const L = [], R = [];
    twoCol.forEach((b, i) => (inLeft[i] ? L : R).push(b));   // 컬럼 내부 순서 유지
    if (!L.length) { L.push(R.shift()); }
    else if (!R.length) { R.push(L.pop()); }

    // 3) 컬럼 구분선 확보 (없으면 생성, 여러 개면 1개만)
    const breaks = Array.from(container.querySelectorAll('.column-break-wrapper'));
    breaks.slice(1).forEach(b => b.remove());
    let brk = breaks[0];
    if (!brk) {
        addColumnBreak();
        brk = container.querySelector('.column-break-wrapper');
        balanceAutoBreak = brk;        // 자동 생성됨 → 끌 때 이 노드만 제거
    } else {
        balanceAutoBreak = null;       // 기존 사용자 구분선 사용 → 제거 대상 아님
    }

    // 4) DOM 재배치: [전체폭들][좌측 섹션들][구분선][우측 섹션들]
    const order = [];
    const pushBlock = b => { if (b.wrapper) order.push(b.wrapper); order.push(...b.items); };
    full.forEach(pushBlock);
    L.forEach(pushBlock);
    order.push(brk);
    R.forEach(pushBlock);
    order.forEach(n => container.appendChild(n));   // appendChild 는 기존 노드를 이동시킴
    return true;
}

/* 주어진 전체 크기(scale)에서 페이지 내용이 차지하는 세로 높이(최소 간격 기준). */
function measurePageHeightAtScale(page, scale) {
    const ctx = getMeasureCtx();
    const { W, fonts } = CONFIG;
    const fullW = W - MARGIN * 2, twoColW = computeTwoColW();
    const scaleSec = sec => ({
        ...sec,
        titleSize: Math.round((sec.titleSize || 24) * scale),
        bodySize: Math.round((sec.bodySize || 20) * scale),
        numSize: Math.round((sec.numSize || 35) * scale)
    });
    const colH = secs => secs.reduce((a, s) => a + measureSection(ctx, scaleSec(s), twoColW, fonts), 0)
        + Math.max(0, secs.length - 1) * currentSectionGap();
    let total = 0;
    page.rows.forEach((row, i) => {
        if (i > 0) total += currentSectionGap();
        total += row.type === 'full'
            ? measureSection(ctx, scaleSec(row.section), fullW, fonts)
            : Math.max(colH(row.left), colH(row.right));
    });
    return total;
}

/* 현재 설정으로 그릴 때의 실제 헤더 높이(px) — 슬라이더 밴드 + 로고 블록.
 * drawA4Canvas 의 headerH 계산과 반드시 같아야 넘침 판정이 실제 결과와 어긋나지 않는다. */
function currentHeaderHeight() {
    const { H } = CONFIG;
    const headerRatio = (parseInt(document.getElementById('headerHeight')?.value || '5', 10)) / 100;
    return Math.round(H * headerRatio) + logoBlockHeight();
}
/* 헤더 높이를 반영한 컨텐츠 영역 가용 세로 높이(px). 넘침 판정·자동 크기 공통 사용. */
function availableContentHeight() {
    const { H } = CONFIG;
    const headerH = currentHeaderHeight();
    return (H - MARGIN) - (headerH + (headerH > 0 ? HEADER_CONTENT_GAP : MARGIN));
}


/* 세그먼트 선택(항목 구분선·박스 모서리) 버튼의 활성 표시를 현재 상태에 맞춘다. */
function syncOptSegUI() {
    const sync = (segId, val) => {
        document.getElementById(segId)?.querySelectorAll('.opt-seg-btn').forEach(btn => {
            const on = btn.dataset.val === val;
            btn.classList.toggle('opt-seg-btn-active', on);
            btn.setAttribute('aria-checked', on ? 'true' : 'false');
        });
    };
    sync('itemDividerSeg', itemDividerStyle);
    sync('boxCornerSeg', boxCornerStyle);
}

/* '섹션 간격' UI 동기화: 균등/자동 맞춤이 켜지면 간격이 자동 분배되므로 슬라이더를 잠가 혼동을 막는다.
 * 좌·우를 묶은 상태(gapLinked)면 우측 행을 감추고 라벨을 '섹션 간격'으로 되돌린다. */
function syncSectionGapUI() {
    // 간격이 자동 분배되는 경우는 '끝까지 채움'일 때뿐 → 그때만 잠금.
    // '높이 맞춤'만 켠 경우엔 수동 간격을 그대로 쓰므로 슬라이더를 열어둔다.
    const gapAuto = layoutBalanced && balanceBottomExact;
    ['sectionGap', 'sectionGapRight', 'sectionGapLabel', 'sectionGapRightLabel'].forEach(id => {
        const el = document.getElementById(id); if (el) el.disabled = gapAuto;
    });
    document.getElementById('sectionGapGroup')?.classList.toggle('auto-locked', gapAuto);

    const row = document.getElementById('gapRightRow');
    if (row) row.hidden = gapLinked;
    const btn = document.getElementById('gapLinkBtn');
    if (btn) {
        btn.classList.toggle('linked', gapLinked);
        btn.setAttribute('aria-pressed', gapLinked ? 'true' : 'false');
        btn.title = gapLinked ? '좌·우 간격을 따로 조절하려면 누르세요' : '좌·우 간격을 같은 값으로 묶으려면 누르세요';
    }
    const text = document.getElementById('sectionGapLabelText');
    if (text) text.textContent = gapLinked ? '섹션 간격' : '섹션 간격 (좌측)';
}
/* 좌·우를 묶은 상태에서는 우측 값을 좌측에 맞춰 따라가게 한다(우측 슬라이더는 숨겨져 있음). */
function mirrorGapRight() {
    if (!gapLinked) return;
    const left = document.getElementById('sectionGap');
    const right = document.getElementById('sectionGapRight');
    if (!left || !right) return;
    right.value = left.value;
    updateSliderBg(right);
    const rl = document.getElementById('sectionGapRightLabel');
    if (rl) rl.value = left.value;
}

function generateImages() {
    syncDocLang();   // 폰트 체인부터 확정 — 이후 측정·그리기가 모두 같은 폰트를 쓰게
    const pages = parseDomToPages();
    if (layoutBalanced) {
        // 균등 맞춤 ON: DOM(구분선)이 이미 균형 배치를 반영하므로 그대로 신뢰.
        // 단, 구분선이 없어 한쪽에 몰린 행만 높이 기준으로 분할.
        pages.forEach(page => page.rows.forEach(row => {
            if (row.type === 'split' && row.right.length === 0) balanceRow(row);
        }));
    } else {
        pages.forEach(expandEmptyRightToFull);
    }
    const previewContainer = document.getElementById('previewContainer');
    const statusChip = document.getElementById('statusChip');

    if (pages.length === 0) {
        previewContainer.innerHTML = `<div class="placeholder-text" id="placeholder"><p style="font-size:40px;margin-bottom:16px;">📄</p>A4 출력 이미지가 여기에 표시됩니다.<br><span style="font-size:13px;color:#ABB3BB;">섹션과 항목을 추가해 시작하세요</span></div>`;
        generatedImagesUrls = [];
        if (statusChip) { statusChip.textContent = ''; statusChip.className = 'status-chip'; }
        setFloatingWarn('');
        return;
    }

    if (statusChip) { statusChip.textContent = '생성 중…'; statusChip.className = 'status-chip generating'; }

    const themeColor = document.getElementById('themeHex')?.value || '#000000';
    const numColor = document.getElementById('numColorHex')?.value || '#000000';
    const hlColor = document.getElementById('hlColorHex')?.value || '#FFEB3B';
    const itemHlColor = document.getElementById('itemHlColorHex')?.value || '#FF0000';
    const labelBoxColor = document.getElementById('labelBoxColorHex')?.value || '#000000';
    const headerRatio = (parseInt(document.getElementById('headerHeight')?.value || '5', 10)) / 100;
    const topText = document.getElementById('topText')?.value || '';
    const periodText = document.getElementById('periodText')?.value || '';
    const periodNote = document.getElementById('periodNote')?.value || '';
    const textColor = document.getElementById('textColorHex')?.value || '#000000';
    const textScale = (parseInt(document.getElementById('textScale')?.value || '100', 10)) / 100;

    requestAnimationFrame(() => {
        try {
            // 넘침 판정: 크기 적용 전 원본 크기 + 현재 배율로 최소 컨텐츠 높이를 측정해 가용 높이와 비교.
            // (실제 그리기는 넘친 부분을 조용히 잘라내므로, 잘림 여부를 사용자에게 알림)
            const avail = availableContentHeight();
            const overflow = pages.some(p => measurePageHeightAtScale(p, textScale) > avail + 1);
            // 헤더 높이 0 → 제목·기간·우측텍스트가 출력에서 빠짐(밴드 공간이 없어 의도된 동작이나 사용자에게 알림)
            const headerTextDropped = headerRatio === 0 && !!(topText || periodText || periodNote);

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
            sectionPreviewRects = [];   // 북마크 → 미리보기 하이라이트용 섹션 위치 맵(재생성)
            const canvases = pages.map((page, pi) =>
                drawA4Canvas(cachedBgImg, page.rows, headerRatio, themeColor, numColor, topText, periodText, textColor, periodNote, hlColor, itemHlColor, labelBoxColor, layoutBalanced, layoutBalanced && balanceBottomExact, { page: pi, rects: sectionPreviewRects }, cachedLogoImg, logoSizePct, logoTopPad)
            );

            generatedImagesUrls = canvases.map(c => c.toDataURL('image/jpeg', 0.95));

            previewContainer.innerHTML = '';
            generatedImagesUrls.forEach((url, i) => {
                const img = document.createElement('img');
                img.src = url;
                img.alt = `A4 이미지 ${i + 1}`;
                previewContainer.appendChild(img);
            });

            // 경고 메시지 1곳에서 계산 → 상단 상태칩 + 화면 고정 배너 동기화
            let warnMsg = '';
            if (overflow) {
                warnMsg = '⚠ 내용이 넘쳐 일부가 잘렸습니다 — 텍스트 크기 축소·컬럼 분리 권장';
            } else if (headerTextDropped) {
                warnMsg = '⚠ 헤더 높이가 0이라 제목·기간이 표시되지 않습니다';
            }
            if (statusChip) {
                statusChip.textContent = warnMsg || `${pages.length}페이지 완료`;
                statusChip.className = warnMsg ? 'status-chip warn' : 'status-chip done';
            }
            setFloatingWarn(warnMsg);   // 하단에서 편집 중에도 보이도록 화면 고정 배너
        } catch (err) {
            console.error('이미지 생성 실패:', err);
            if (statusChip) { statusChip.textContent = '생성 중 오류 발생'; statusChip.className = 'status-chip error'; }
            setFloatingWarn('⚠ 생성 중 오류 발생');
        }
    });
}

let _genTimer = null;
function debouncedGenerateImages() {
    clearTimeout(_genTimer);
    _genTimer = setTimeout(generateImages, 300);
}
/* 디바운스 대기 중인 렌더를 취소하고 즉시 그린다(되돌리기/다시실행 등 지연 없이 반영). */
function renderImagesNow() {
    clearTimeout(_genTimer);
    generateImages();
}

/* 화면 하단 고정 경고 배너 — 상단 미리보기 칩이 스크롤로 안 보일 때를 대비.
 * 경고가 있을 때만 표시, 없으면 숨김. */
function setFloatingWarn(msg) {
    const el = document.getElementById('floatingWarn');
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; }
    else { el.hidden = true; el.textContent = ''; }
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
    },
    hlColorPresets: {
        storageKey: 'a4HlColorSlots',
        getColor: () => document.getElementById('hlColorHex')?.value || '#FFEB3B',
        apply: c => { updateHlColorSync(c); saveSnapshot(); debouncedGenerateImages(); }
    },
    itemHlColorPresets: {
        storageKey: 'a4ItemHlColorSlots',
        getColor: () => document.getElementById('itemHlColorHex')?.value || '#FF0000',
        apply: c => { updateItemHlColorSync(c); saveSnapshot(); debouncedGenerateImages(); }
    },
    labelBoxColorPresets: {
        storageKey: 'a4LabelBoxColorSlots',
        getColor: () => document.getElementById('labelBoxColorHex')?.value || '#000000',
        apply: c => { updateLabelBoxColorSync(c); saveSnapshot(); debouncedGenerateImages(); }
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

/* ── 커스텀 저장 색상 팔레트의 백업 포함 ──
 * 팔레트는 localStorage 에만 있어 백업 파일만 옮기면 다른 PC·브라우저에서 사라진다.
 * 그래서 저장할 때 파일에 함께 담고, 불러올 때 되돌려 놓는다.
 * (Undo/Redo·세션 저장에는 넣지 않음 — 팔레트는 작업물이 아니라 브라우저 설정이므로) */
const THEME_COLOR_SLOT_KEY = 'a4ColorSlots';
function colorSlotKeys() {
    return [THEME_COLOR_SLOT_KEY, ...Object.values(MINI_PRESET_META).map(m => m.storageKey)];
}
/* 현재 팔레트 전체를 { localStorage 키: [색상…] } 로 수집. 비어 있는 키는 넣지 않음. */
function collectColorSlots() {
    const out = {};
    for (const key of colorSlotKeys()) {
        const slots = loadMiniSlots(key);   // 검증(6개 이하·#RRGGBB)이 같아 그대로 재사용
        if (slots.length) out[key] = slots;
    }
    return out;
}
/* 백업에서 읽은 팔레트를 localStorage 에 반영하고 프리셋 UI를 다시 그린다.
 * 모르는 키·형식이 틀린 값은 무시(손상·악의적 파일 방어). 반영된 게 있으면 true. */
function applyColorSlots(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const valid = new Set(colorSlotKeys());
    let changed = false;
    for (const [key, slots] of Object.entries(data)) {
        if (!valid.has(key)) continue;
        if (!Array.isArray(slots) || slots.length > 6 || !slots.every(c => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c))) continue;
        try { localStorage.setItem(key, JSON.stringify(slots)); changed = true; } catch (e) {}
    }
    if (changed) renderAllColorPresets();
    return changed;
}
/* 테마 프리셋 + 미니 슬롯 5종을 한 번에 다시 그림(최초 로드·백업 복원 공용). */
function renderAllColorPresets() {
    renderColorPresets();
    Object.keys(MINI_PRESET_META).forEach(renderMiniColorPresets);
}
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
/* 색상 피커·헥스 입력·스와치 3종을 한 색상값으로 동기화하는 공통 처리. */
function applyColorSync(pickerId, hexId, swatchId, upper) {
    const picker = document.getElementById(pickerId);
    const hexInput = document.getElementById(hexId);
    const swatch = document.getElementById(swatchId);
    if (picker) picker.value = upper;
    if (hexInput) hexInput.value = upper;
    if (swatch) swatch.style.backgroundColor = upper;
}
function updateColorSync(hex) {
    const upper = hex.toUpperCase();
    applyColorSync('themeColor', 'themeHex', 'themeSwatch', upper);
    syncPresetActive(upper);   // 테마색상만: 프리셋 활성화 + 제목 바 색상 동기화
    document.documentElement.style.setProperty('--h1-bar-color', upper);
}
function updateTextColorSync(hex)     { applyColorSync('textColorPicker', 'textColorHex', 'textColorSwatch', hex.toUpperCase()); }
function updateNumColorSync(hex)      { applyColorSync('numColorPicker', 'numColorHex', 'numColorSwatch', hex.toUpperCase()); }
function updateHlColorSync(hex)       { applyColorSync('hlColorPicker', 'hlColorHex', 'hlColorSwatch', hex.toUpperCase()); }
function updateItemHlColorSync(hex)   { applyColorSync('itemHlColorPicker', 'itemHlColorHex', 'itemHlColorSwatch', hex.toUpperCase()); }
function updateLabelBoxColorSync(hex) { applyColorSync('labelBoxColorPicker', 'labelBoxColorHex', 'labelBoxColorSwatch', hex.toUpperCase()); }

function updateSliderBg(slider) {
    const val = slider.value, min = slider.min || 0, max = slider.max || 100;
    const pct = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--primary) 0%, var(--primary) ${pct}%, #E5E8EB ${pct}%, #E5E8EB 100%)`;
}

/* ============================================================
 * 배경 이미지 표시
 * ============================================================ */
/* 배경 썸네일·파일명·드롭존 상태를 한 번에 반영. name 을 주면 파일명 라벨까지 복원한다
 * (불러오기·세션 복원에서도 처음 선택했을 때와 같은 모습이 되도록). */
function showBgThumb(src, name = bgFileName) {
    const thumb = document.getElementById('bgThumb');
    if (thumb) { thumb.src = src; thumb.classList.add('visible'); }
    const sub = document.getElementById('fileLabelSub');
    if (sub) sub.textContent = '배경 이미지 로드됨';
    bgFileName = String(name || '').slice(0, MAX_BG_NAME_LEN);
    const main = document.getElementById('fileLabelMain');
    if (main) main.textContent = bgFileName || BG_LABEL_DEFAULT;
    document.getElementById('dropZone')?.classList.add('file-attached');
}
function hideBgThumb() {
    const thumb = document.getElementById('bgThumb');
    if (thumb) { thumb.src = ''; thumb.classList.remove('visible'); }
    const sub = document.getElementById('fileLabelSub');
    if (sub) sub.textContent = '';
    bgFileName = '';
    const main = document.getElementById('fileLabelMain');
    if (main) main.textContent = BG_LABEL_DEFAULT;
    document.getElementById('dropZone')?.classList.remove('file-attached');
}

/* 로고 드롭존 표시 — 배경과 같은 규칙. 크기 슬라이더는 로고가 있을 때만 노출한다. */
function showLogoThumb(src, name = logoFileName) {
    const thumb = document.getElementById('logoThumb');
    if (thumb) { thumb.src = src; thumb.classList.add('visible'); }
    const sub = document.getElementById('logoFileLabelSub');
    if (sub) sub.textContent = '로고 이미지 로드됨';
    logoFileName = String(name || '').slice(0, MAX_BG_NAME_LEN);
    const main = document.getElementById('logoFileLabelMain');
    if (main) main.textContent = logoFileName || BG_LABEL_DEFAULT;
    document.getElementById('logoDropZone')?.classList.add('file-attached');
    syncLogoScaleUI();
}
function hideLogoThumb() {
    const thumb = document.getElementById('logoThumb');
    if (thumb) { thumb.src = ''; thumb.classList.remove('visible'); }
    const sub = document.getElementById('logoFileLabelSub');
    if (sub) sub.textContent = '';
    logoFileName = '';
    const main = document.getElementById('logoFileLabelMain');
    if (main) main.textContent = BG_LABEL_DEFAULT;
    document.getElementById('logoDropZone')?.classList.remove('file-attached');
    syncLogoScaleUI();
}
/* 로고 크기·세로 위치 슬라이더 값과 표시 여부 동기화(로고가 있을 때만 노출). */
function syncLogoScaleUI() {
    const group = document.getElementById('logoScaleGroup');
    if (group) group.hidden = !cachedLogoImg;
    [['logoScale', 'logoScaleLabel', logoSizePct], ['logoTop', 'logoTopLabel', logoTopPad]]
        .forEach(([sliderId, labelId, val]) => {
            const slider = document.getElementById(sliderId);
            if (slider) { slider.value = val; updateSliderBg(slider); }
            const label = document.getElementById(labelId);
            if (label) label.value = val;
        });
}

/* ============================================================
 * 프로젝트 저장 / 불러오기
 * ============================================================ */
/* CDN(JSZip/FileSaver) 로드 여부 확인. 차단·오프라인 시 친절히 안내. */
function ensureSaveLib() {
    if (typeof saveAs === 'undefined') {
        showColorToast('저장 라이브러리를 불러오지 못했습니다. 네트워크 연결 후 새로고침해 주세요.');
        return false;
    }
    return true;
}

function saveProject() {
    if (!ensureSaveLib()) return;
    const data = getSnapshot();
    if (cachedBgImg?.src?.startsWith('data:')) {
        data.bgImage = cachedBgImg.src;
        if (bgFileName) data.bgName = bgFileName;   // 파일명까지 담아 드롭존 표시를 그대로 복원
    }
    if (cachedLogoImg?.src?.startsWith('data:')) {
        data.logoImage = cachedLogoImg.src;
        if (logoFileName) data.logoName = logoFileName;
    }
    // 커스텀 저장 색상 팔레트도 함께 담아 다른 PC에서 열어도 유지되게
    const slots = collectColorSlots();
    if (Object.keys(slots).length) data.colorSlots = slots;
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
            applyColorSlots(data.colorSlots);   // 팔레트 먼저 — 이후 프리셋 렌더가 새 슬롯을 반영하도록
            restoreSnapshot(data);
            // 이전 선택 파일 해제 — 같은 파일을 다시 골라도 change 가 뜨도록
            const bgInput = document.getElementById('bgInput');
            if (bgInput) bgInput.value = '';
            const logoInput = document.getElementById('logoInput');
            if (logoInput) logoInput.value = '';

            // 배경·로고도 저장 시점 상태와 정확히 일치시킨다 — 백업에 있으면 그 이미지로,
            // 없었으면(저장 당시 없음) 현재 것을 비운다.
            // 이미지 로드는 비동기라, 모두 끝난 뒤 한 번만 렌더·저장 표시하도록 센다.
            const hadBg = !!cachedBgImg, hadLogo = !!cachedLogoImg;   // 안내 문구용 — 실제로 비워진 것만 알리기
            let pending = 1;   // 본문 처리 자체를 1건으로 세어 이미지가 없어도 마무리가 실행되게
            const settle = () => { if (--pending === 0) { generateImages(); markSaved(); } };
            const loadInto = (src, name, apply, clear, failMsg) => {
                if (!src) { clear(); return; }
                pending++;
                const img = new Image();
                img.onload = () => { apply(img, src, name); settle(); };
                img.onerror = () => { clear(); showColorToast(failMsg); settle(); };
                img.src = src;
            };
            loadInto(data.bgImage, data.bgName,
                (img, src, name) => { cachedBgImg = img; showBgThumb(src, name); },
                clearBackground, '배경 이미지를 복원하지 못했습니다. 데이터 본문은 정상 적용됐습니다.');
            loadInto(data.logoImage, data.logoName,
                (img, src, name) => { cachedLogoImg = img; showLogoThumb(src, name); },
                clearLogo, '로고 이미지를 복원하지 못했습니다. 데이터 본문은 정상 적용됐습니다.');

            const restored = [], emptied = [];
            if (data.bgImage) restored.push('배경'); else if (hadBg) emptied.push('배경');
            if (data.logoImage) restored.push('로고'); else if (hadLogo) emptied.push('로고');
            showColorToast('불러오기 완료.'
                + (restored.length ? ` ${restored.join('·')} 이미지도 함께 복원되었습니다.` : '')
                + (emptied.length ? ` 저장 당시 없던 항목(${emptied.join('·')})은 비웠습니다.` : ''));
            settle();
        } catch(err) { showColorToast('잘못된 백업 파일입니다.'); }
    };
    reader.onerror = () => showColorToast('파일을 읽지 못했습니다. 다시 시도해 주세요.');
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
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
            return showColorToast('압축 라이브러리를 불러오지 못했습니다. 네트워크 연결 후 새로고침해 주세요.');
        }
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
    if (btn) { btn.textContent = isAllCollapsed ? '모두 펼치기' : '모두 접기'; btn.setAttribute('aria-pressed', isAllCollapsed ? 'true' : 'false'); }
    document.querySelectorAll('#itemsContainer .section-title-wrapper').forEach(node => {
        node.classList.toggle('collapsed', isAllCollapsed);
    });
    refreshAccordionVisibility();
    refreshBookmarks();
    saveSnapshot();
}

/* 균등 맞춤 켜기 직전 상태를 저장해 두었다가 끌 때 그대로 되돌린다. */
function captureBalanceSnapshot() {
    const container = document.getElementById('itemsContainer');
    const slider = document.getElementById('textScale');
    balanceSnapshot = {
        order: Array.from(container.children),   // 재배치 전 자식 노드 순서(노드 참조 유지)
        textScale: slider ? slider.value : null
    };
}
function restoreBalanceSnapshot() {
    if (!balanceSnapshot) return;
    const container = document.getElementById('itemsContainer');
    // 켤 때 자동 생성한 구분선만 제거 (사용자가 추가한 내용은 절대 지우지 않음)
    if (balanceAutoBreak && balanceAutoBreak.isConnected) balanceAutoBreak.remove();
    balanceAutoBreak = null;
    // 저장해 둔 원래 순서대로 다시 배치 (스냅샷에 있던 노드만)
    const keep = new Set(balanceSnapshot.order);
    balanceSnapshot.order.forEach(n => { if (n.isConnected) container.appendChild(n); });
    // 균등 맞춤 중 새로 추가된 노드는 원래 내용 뒤에 그대로 이어 붙여 보존
    Array.from(container.children).forEach(n => { if (!keep.has(n)) container.appendChild(n); });
    // 텍스트 크기 슬라이더 복원
    const slider = document.getElementById('textScale');
    if (slider && balanceSnapshot.textScale != null) {
        slider.value = balanceSnapshot.textScale;
        const label = document.getElementById('textScaleLabel');
        if (label) label.value = balanceSnapshot.textScale;
        updateSliderBg(slider);
    }
    balanceSnapshot = null;
}

/* 균등 맞춤이 켜진 상태에서 내용이 바뀌면 재정렬 필요 표시 (편집 이벤트에서 호출). */
function markBalanceStale() {
    if (!layoutBalanced || balanceStale) return;
    balanceStale = true;
    updateBalanceBtn();
}

/* ── 페이지 배치 3단 세그먼트 ──
 * 'none'(그대로) / 'balance'(높이 맞춤) / 'exact'(끝까지 채움).
 * exact 는 balance 를 포함하는 상위 단계라, 종속 관계가 순서로 드러난다. */
const PAGE_LAYOUT_HINT = {
    none:    '섹션을 좌·우 컬럼에 나누지 않고 입력한 순서 그대로 배치합니다.',
    balance: '좌·우 컬럼의 높이가 비슷해지도록 섹션을 나눕니다. 섹션 간격은 직접 정한 값 그대로예요.',
    exact:   '좌·우 컬럼 아래 끝을 페이지 끝에 정확히 맞춥니다. 섹션 간격은 자동으로 분배됩니다.'
};
function currentPageLayout() {
    if (!layoutBalanced) return 'none';
    return balanceBottomExact ? 'exact' : 'balance';
}
/* 세그먼트 선택 적용. 바뀐 게 없으면 false 를 돌려 재렌더를 생략한다. */
function applyPageLayout(mode) {
    if (!PAGE_LAYOUT_HINT[mode] || mode === currentPageLayout()) return false;
    const wantBalanced = mode !== 'none';
    if (wantBalanced && !layoutBalanced) {
        layoutBalanced = true;
        balanceStale = false;
        captureBalanceSnapshot();      // 되돌리기용 원래 상태 저장
        reorderDomBalanced();          // 섹션을 높이 기준으로 좌/우에 비슷하게 분배(내용만 나눔)
    } else if (!wantBalanced && layoutBalanced) {
        layoutBalanced = false;
        balanceStale = false;
        restoreBalanceSnapshot();      // 켜기 직전 배치·크기로 복원
    }
    balanceBottomExact = mode === 'exact';
    refreshAccordionVisibility();  // 섹션 그룹/접힘 상태 갱신
    refreshBookmarks();            // 북마크(목차) 패널도 배치 반영
    applyColumnTabFilter();        // 좌측/우측 이벤트 탭 필터 갱신
    return true;
}
/* 내용이 바뀐(stale) 상태에서 '다시 맞추기' — 끄지 않고 원래 기준으로 재배치. */
function rebalanceLayout() {
    if (!layoutBalanced) return;
    restoreBalanceSnapshot();      // 이전 균형 흔적(자동 구분선 등) 정리 후 원본 기준 복귀
    captureBalanceSnapshot();      // 갱신된 내용을 새 기준으로 저장
    reorderDomBalanced();          // 다시 좌/우 균형 배치 (텍스트 크기·간격은 손대지 않음)
    balanceStale = false;
    refreshAccordionVisibility();
    refreshBookmarks();
    applyColumnTabFilter();
}

/* 페이지 배치 세그먼트·설명문·'다시 맞추기' 버튼을 현재 상태에 맞춘다. */
function updateBalanceBtn() {
    syncSectionGapUI();   // 배치 단계에 따라 섹션 간격 슬라이더 잠금 동기화
    const mode = currentPageLayout();
    document.getElementById('pageLayoutSeg')?.querySelectorAll('.opt-seg-btn').forEach(btn => {
        const on = btn.dataset.val === mode;
        btn.classList.toggle('opt-seg-btn-active', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const hint = document.getElementById('pageLayoutHint');
    if (hint) hint.textContent = balanceStale
        ? '내용이 바뀌었습니다 — ‘다시 맞추기’를 누르면 좌·우 높이를 새로 계산합니다.'
        : PAGE_LAYOUT_HINT[mode];
    const re = document.getElementById('btnRebalance');
    if (re) re.hidden = !(layoutBalanced && balanceStale);
}

/* ============================================================
 * 초기화
 * ============================================================ */
/* 탭 전환 */
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            document.getElementById(tab === 'design' ? 'tabDesign' : 'tabItems').classList.add('active');
            if (tab !== 'design') resizeVisibleTextareas();   // 항목 탭 표시 시 입력칸 높이 재계산
        });
    });
}

/* 테마·숫자·강조·항목강조·단위박스 색상 피커 */
function initColorPickers() {
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

    // 강조 색상
    const hlColorPicker = document.getElementById('hlColorPicker');
    const hlColorHex = document.getElementById('hlColorHex');
    const hlColorSwatch = document.getElementById('hlColorSwatch');
    hlColorPicker.addEventListener('input', e => {
        const c = e.target.value;
        hlColorHex.value = c.toUpperCase();
        hlColorSwatch.style.backgroundColor = c;
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    hlColorHex.addEventListener('input', e => {
        let c = e.target.value;
        if (!c.startsWith('#')) c = '#' + c;
        if (/^#[0-9A-F]{6}$/i.test(c)) {
            hlColorHex.value = c.toUpperCase();
            hlColorPicker.value = c;
            hlColorSwatch.style.backgroundColor = c;
            debouncedGenerateImages();
        }
    });
    hlColorSwatch.addEventListener('click', () => hlColorPicker.click());
    [hlColorPicker, hlColorHex].forEach(el => {
        el.addEventListener('focus', () => { el._before = el.value; });
        el.addEventListener('blur', () => { if (el._before !== el.value) saveSnapshot(); });
    });

    // 항목 강조 색상
    const itemHlColorPicker = document.getElementById('itemHlColorPicker');
    const itemHlColorHex = document.getElementById('itemHlColorHex');
    const itemHlColorSwatch = document.getElementById('itemHlColorSwatch');
    itemHlColorPicker.addEventListener('input', e => {
        const c = e.target.value;
        itemHlColorHex.value = c.toUpperCase();
        itemHlColorSwatch.style.backgroundColor = c;
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    itemHlColorHex.addEventListener('input', e => {
        let c = e.target.value;
        if (!c.startsWith('#')) c = '#' + c;
        if (/^#[0-9A-F]{6}$/i.test(c)) {
            itemHlColorHex.value = c.toUpperCase();
            itemHlColorPicker.value = c;
            itemHlColorSwatch.style.backgroundColor = c;
            debouncedGenerateImages();
        }
    });
    itemHlColorSwatch.addEventListener('click', () => itemHlColorPicker.click());
    [itemHlColorPicker, itemHlColorHex].forEach(el => {
        el.addEventListener('focus', () => { el._before = el.value; });
        el.addEventListener('blur', () => { if (el._before !== el.value) saveSnapshot(); });
    });

    // 단위박스 색상
    const labelBoxColorPicker = document.getElementById('labelBoxColorPicker');
    const labelBoxColorHex = document.getElementById('labelBoxColorHex');
    const labelBoxColorSwatch = document.getElementById('labelBoxColorSwatch');
    labelBoxColorPicker.addEventListener('input', e => {
        const c = e.target.value;
        labelBoxColorHex.value = c.toUpperCase();
        labelBoxColorSwatch.style.backgroundColor = c;
        debouncedGenerateImages();
        handleInputSnapshot();
    });
    labelBoxColorHex.addEventListener('input', e => {
        let c = e.target.value;
        if (!c.startsWith('#')) c = '#' + c;
        if (/^#[0-9A-F]{6}$/i.test(c)) {
            labelBoxColorHex.value = c.toUpperCase();
            labelBoxColorPicker.value = c;
            labelBoxColorSwatch.style.backgroundColor = c;
            debouncedGenerateImages();
        }
    });
    labelBoxColorSwatch.addEventListener('click', () => labelBoxColorPicker.click());
    [labelBoxColorPicker, labelBoxColorHex].forEach(el => {
        el.addEventListener('focus', () => { el._before = el.value; });
        el.addEventListener('blur', () => { if (el._before !== el.value) saveSnapshot(); });
    });
}

/* 헤더 높이 · 섹션 간격(좌·우 묶기) · 전체 텍스트 크기 */
function initSliders() {
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
        if (isNaN(v)) v = 5;
        v = Math.min(Math.max(v, 0), 55);
        headerHeightInput.value = v;
        slider.value = v;
        updateSliderBg(slider);
        saveSnapshot();
    });

    // 섹션 간격 슬라이더 (왼쪽/오른쪽 각각 동일 배선).
    // 좌측을 움직이면 묶인 상태에서 우측도 같이 따라간다(mirrorGapRight).
    function wireGapSlider(sliderId, labelId) {
        const slider = document.getElementById(sliderId);
        if (!slider) return;
        const input = document.getElementById(labelId);
        const isLeft = sliderId === 'sectionGap';
        slider.addEventListener('input', () => {
            if (input) input.value = slider.value;
            updateSliderBg(slider);
            if (isLeft) mirrorGapRight();
            debouncedGenerateImages();
            handleInputSnapshot();
        });
        updateSliderBg(slider);
        if (!input) return;
        input.addEventListener('input', () => {
            let v = parseInt(input.value);
            if (isNaN(v)) return;
            v = Math.min(Math.max(v, 0), 60);
            slider.value = v;
            updateSliderBg(slider);
            if (isLeft) mirrorGapRight();
            debouncedGenerateImages();
            handleInputSnapshot();
        });
        input.addEventListener('blur', () => {
            let v = parseInt(input.value);
            if (isNaN(v)) v = 15;
            v = Math.min(Math.max(v, 0), 60);
            input.value = v;
            slider.value = v;
            updateSliderBg(slider);
            if (isLeft) mirrorGapRight();
            saveSnapshot();
        });
    }
    wireGapSlider('sectionGap', 'sectionGapLabel');
    wireGapSlider('sectionGapRight', 'sectionGapRightLabel');

    // 전체 텍스트 크기 슬라이더
    const textScaleSlider = document.getElementById('textScale');
    textScaleSlider.addEventListener('input', () => {
        document.getElementById('textScaleLabel').value = textScaleSlider.value;
        manualTextScale = parseInt(textScaleSlider.value) || 100;   // 사용자 수동 값 기억
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
        manualTextScale = v;   // 사용자 수동 값 기억
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
        manualTextScale = v;   // 사용자 수동 값 기억
        updateSliderBg(textScaleSlider);
        saveSnapshot();
    });

    syncSectionGapUI();   // 섹션 간격 슬라이더 초기 잠금·묶음 상태 반영
    updateBalanceBtn();   // 페이지 배치 세그먼트 초기 표시

    // 좌·우 간격 묶기/풀기 — 묶으면 우측 행을 감추고 좌측 값을 따라가게 한다
    document.getElementById('gapLinkBtn')?.addEventListener('click', () => {
        gapLinked = !gapLinked;
        mirrorGapRight();   // 묶는 순간 좌측 값으로 통일(풀 때는 마지막 값이 그대로 남음)
        syncSectionGapUI();
        generateImages();
        saveSnapshot();
    });
}

/* 텍스트 색상 + 제목·기간·기간 우측(의료법 검사·서식 툴바 포함) */
function initHeaderFields() {
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
    // 제목·기간·기간 우측 텍스트 의료법 검사 — 항목 영역 밖이라 위임이 닿지 않아 개별 배선
    ['topText', 'periodText', 'periodNote'].forEach(id => wireViolationCheck(document.getElementById(id)));
    // 패널이 스크롤되면 열려 있던 툴팁을 닫는다(위치가 한 번만 계산되어 제자리에 남기 때문)
    document.addEventListener('scroll', dismissViolationTooltips, { capture: true, passive: true });

    const topInput = document.getElementById('topText');
    topInput.addEventListener('input', () => { autoResizeTextarea(topInput); debouncedGenerateImages(); handleInputSnapshot(); });
    topInput.addEventListener('focus', () => { topInput._before = topInput.value; });
    topInput.addEventListener('blur', () => { if (topInput._before !== topInput.value) saveSnapshot(); });
    // 제목 서식 툴바
    topInput.closest('.item-name-wrapper')?.addEventListener('mousedown', e => {
        const btn = e.target.closest('.fmt-btn');
        if (!btn) return;
        e.preventDefault();
        const open = btn.dataset.open, close = btn.dataset.close;
        const s = topInput.selectionStart, end = topInput.selectionEnd;
        const sel = topInput.value.substring(s, end);
        topInput.value = topInput.value.substring(0, s) + open + sel + close + topInput.value.substring(end);
        const cursor = sel ? s + open.length + sel.length + close.length : s + open.length;
        topInput.setSelectionRange(cursor, cursor);
        topInput.focus();
        autoResizeTextarea(topInput);
        updateViolationUI(topInput);   // 서식 토큰 삽입으로 문구가 바뀌므로 다시 검사
        debouncedGenerateImages();
        handleInputSnapshot();
    });

    // 이벤트 기간
    const periodInput = document.getElementById('periodText');
    periodInput.addEventListener('input', () => { debouncedGenerateImages(); handleInputSnapshot(); });
    periodInput.addEventListener('focus', () => { periodInput._before = periodInput.value; });
    periodInput.addEventListener('blur', () => { if (periodInput._before !== periodInput.value) saveSnapshot(); });
    // 이벤트 기간 서식 툴바
    periodInput.closest('.item-name-wrapper')?.addEventListener('mousedown', e => {
        const btn = e.target.closest('.fmt-btn');
        if (!btn) return;
        e.preventDefault();
        const open = btn.dataset.open, close = btn.dataset.close;
        const s = periodInput.selectionStart, end = periodInput.selectionEnd;
        const sel = periodInput.value.substring(s, end);
        periodInput.value = periodInput.value.substring(0, s) + open + sel + close + periodInput.value.substring(end);
        const cursor = sel ? s + open.length + sel.length + close.length : s + open.length;
        periodInput.setSelectionRange(cursor, cursor);
        periodInput.focus();
        updateViolationUI(periodInput);   // 서식 토큰 삽입으로 문구가 바뀌므로 다시 검사
        debouncedGenerateImages();
        handleInputSnapshot();
    });

    // 기간 우측 텍스트
    const periodNoteInput = document.getElementById('periodNote');
    periodNoteInput.addEventListener('input', () => { debouncedGenerateImages(); handleInputSnapshot(); });
    periodNoteInput.addEventListener('focus', () => { periodNoteInput._before = periodNoteInput.value; });
    periodNoteInput.addEventListener('blur', () => { if (periodNoteInput._before !== periodNoteInput.value) saveSnapshot(); });
    // 기간 우측 텍스트 서식 툴바
    periodNoteInput.closest('.item-name-wrapper')?.addEventListener('mousedown', e => {
        const btn = e.target.closest('.fmt-btn');
        if (!btn) return;
        e.preventDefault();
        const open = btn.dataset.open, close = btn.dataset.close;
        const s = periodNoteInput.selectionStart, end = periodNoteInput.selectionEnd;
        const sel = periodNoteInput.value.substring(s, end);
        periodNoteInput.value = periodNoteInput.value.substring(0, s) + open + sel + close + periodNoteInput.value.substring(end);
        const cursor = sel ? s + open.length + sel.length + close.length : s + open.length;
        periodNoteInput.setSelectionRange(cursor, cursor);
        periodNoteInput.focus();
        updateViolationUI(periodNoteInput);   // 서식 토큰 삽입으로 문구가 바뀌므로 다시 검사
        debouncedGenerateImages();
        handleInputSnapshot();
    });
}

/* 배경·로고 드롭존 + 로고 크기·세로 위치 슬라이더 */
function initImageInputs() {
    // apply: 이미지가 준비됐을 때 캐시에 넣고 썸네일을 표시, clear: 선택 해제 시 초기화, isSet: 현재 들어있는지.
    const wireImageDropZone = ({ zoneId, inputId, labelMainId, clearBtnId, apply, clear, isSet }) => {
        const zone = document.getElementById(zoneId);
        const input = document.getElementById(inputId);
        if (!zone || !input) return;
        // needType: 드롭은 아무 파일이나 떨어질 수 있어 형식을 확인. 파일 선택은 accept="image/*" 로 이미 걸러진다.
        const accept = (file, needType) => {
            if (!file) return false;
            if (needType && !file.type.startsWith('image/')) return false;
            if (file.size > MAX_IMAGE_BYTES) { showColorToast('이미지 파일 크기는 20MB 이하로 선택해 주세요.'); return false; }
            return true;
        };
        const read = file => {
            saveSnapshot();
            const reader = new FileReader();
            reader.onload = ev => {
                const img = new Image();
                img.onload = () => { apply(img, ev.target.result, file.name); debouncedGenerateImages(); };
                img.onerror = () => showColorToast('이미지를 불러오지 못했습니다. 다른 파일을 선택해 주세요.');
                img.src = ev.target.result;
            };
            reader.onerror = () => showColorToast('파일을 읽지 못했습니다. 다시 시도해 주세요.');
            reader.readAsDataURL(file);
            // 디코딩 전이라도 선택한 파일명을 먼저 보여줘 반응이 즉시 보이게
            const main = document.getElementById(labelMainId);
            if (main) main.textContent = file.name;
            zone.classList.add('file-attached');
        };
        input.addEventListener('change', e => {
            if (!e.target.files?.length) { clear(); debouncedGenerateImages(); return; }
            const file = e.target.files[0];
            if (!accept(file, false)) { e.target.value = ''; return; }
            read(file);
        });
        zone.addEventListener('click', () => input.click());
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('file-attached'); });
        zone.addEventListener('dragleave', () => { if (!isSet()) zone.classList.remove('file-attached'); });
        zone.addEventListener('drop', e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (!accept(file, true)) { if (!isSet()) zone.classList.remove('file-attached'); return; }
            read(file);
        });
        // 제거 버튼 — 드롭존 클릭(파일 선택 열기)으로 번지지 않도록 전파를 막는다.
        // 이미지 자체는 되돌리기 대상이 아니라(배경·로고 공통) 스냅샷 대신 '저장 안 됨' 표시만 갱신.
        document.getElementById(clearBtnId)?.addEventListener('click', e => {
            e.stopPropagation();
            if (!isSet()) return;
            clear();
            debouncedGenerateImages();
            markUnsaved();
        });
    };
    wireImageDropZone({
        zoneId: 'dropZone', inputId: 'bgInput', labelMainId: 'fileLabelMain', clearBtnId: 'bgClear',
        apply: (img, src, name) => { cachedBgImg = img; showBgThumb(src, name); },
        clear: clearBackground, isSet: () => !!cachedBgImg
    });
    wireImageDropZone({
        zoneId: 'logoDropZone', inputId: 'logoInput', labelMainId: 'logoFileLabelMain', clearBtnId: 'logoClear',
        apply: (img, src, name) => { cachedLogoImg = img; showLogoThumb(src, name); },
        clear: clearLogo, isSet: () => !!cachedLogoImg
    });

    // 로고 크기(50~150%) · 세로 위치(0~120px) — 배선이 같아 한 곳에서 처리.
    // set 은 전역 상태에 반영하고 정리된 값을 돌려준다(범위 밖 입력을 걸러내기 위해).
    const wireLogoSlider = ({ sliderId, labelId, def, set }) => {
        const slider = document.getElementById(sliderId);
        const input = document.getElementById(labelId);
        const push = raw => {
            const v = set(Number.isFinite(raw) ? raw : def);
            if (slider) { slider.value = v; updateSliderBg(slider); }
            return v;
        };
        slider?.addEventListener('input', () => {
            const v = push(parseInt(slider.value, 10));
            if (input) input.value = v;
            debouncedGenerateImages();
            handleInputSnapshot();
        });
        input?.addEventListener('input', () => {
            const v = parseInt(input.value, 10);
            if (isNaN(v)) return;   // 지우는 중에는 건드리지 않음 — blur 에서 정리
            push(v);
            debouncedGenerateImages();
            handleInputSnapshot();
        });
        input?.addEventListener('blur', () => {
            input.value = push(parseInt(input.value, 10));
            saveSnapshot();
        });
    };
    const clampTo = (v, min, max) => Math.min(Math.max(v, min), max);
    wireLogoSlider({
        sliderId: 'logoScale', labelId: 'logoScaleLabel', def: LOGO_SCALE_DEFAULT,
        set: v => (logoSizePct = clampTo(v, LOGO_SCALE_MIN, LOGO_SCALE_MAX))
    });
    wireLogoSlider({
        sliderId: 'logoTop', labelId: 'logoTopLabel', def: LOGO_TOP_DEFAULT,
        set: v => (logoTopPad = clampTo(v, LOGO_TOP_MIN, LOGO_TOP_MAX))
    });
    syncLogoScaleUI();
}

/* 항목 추가 버튼 · 좌우 탭 · 페이지 배치 세그먼트 */
function initItemControls() {
    document.getElementById('addSectionBtn').addEventListener('click', () => {
        saveSnapshot(); markBalanceStale(); const el = addSectionTitle();
        if (activeColumnTab === 'left') {
            const c = document.getElementById('itemsContainer');
            const cb = c.querySelector('.column-break-wrapper');
            if (cb) c.insertBefore(c.lastElementChild, cb);
        }
        applyColumnTabFilter();
        scrollToItem(el);
    });
    document.getElementById('addItemBtn').addEventListener('click', () => {
        saveSnapshot(); markBalanceStale(); const el = addItemRow();
        if (activeColumnTab === 'left') {
            const c = document.getElementById('itemsContainer');
            const cb = c.querySelector('.column-break-wrapper');
            if (cb) c.insertBefore(c.lastElementChild, cb);
        }
        applyColumnTabFilter();
        scrollToItem(el);
    });
    document.getElementById('addColumnBreakBtn').addEventListener('click', () => {
        saveSnapshot(); markBalanceStale(); addColumnBreak(); applyColumnTabFilter();
    });
    document.querySelectorAll('.col-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const newTab = btn.dataset.col;
            if (newTab === activeColumnTab) return;
            if (newTab === 'right') {
                const c = document.getElementById('itemsContainer');
                const hasBreak = Array.from(c.children).some(n => n.classList.contains('column-break-wrapper'));
                if (!hasBreak) { saveSnapshot(); addColumnBreak(); }
            }
            activeColumnTab = newTab;
            applyColumnTabFilter();
        });
    });
    document.getElementById('btnToggleAll').addEventListener('click', toggleAllSections);

    // 페이지 배치 — 그대로 / 높이 맞춤 / 끝까지 채움
    document.getElementById('pageLayoutSeg')?.addEventListener('click', e => {
        const btn = e.target.closest('.opt-seg-btn');
        if (!btn || !applyPageLayout(btn.dataset.val)) return;   // 같은 단계면 재렌더 생략
        updateBalanceBtn();
        generateImages();
        saveSnapshot();
    });
    document.getElementById('btnRebalance')?.addEventListener('click', () => {
        rebalanceLayout();
        updateBalanceBtn();
        generateImages();
        saveSnapshot();
    });
}

/* 항목 구분선 · 박스 모서리 세그먼트 */
function initOptionSegments() {
    const bindOptSeg = (segId, apply) => {
        document.getElementById(segId)?.addEventListener('click', e => {
            const btn = e.target.closest('.opt-seg-btn');
            if (!btn || !btn.dataset.val) return;
            if (!apply(btn.dataset.val)) return;   // 같은 값이면 재렌더 생략
            syncOptSegUI();
            generateImages();
            saveSnapshot();
        });
    };
    bindOptSeg('itemDividerSeg', v => {
        if (ITEM_DIVIDER_DASH[v] === undefined || v === itemDividerStyle) return false;
        itemDividerStyle = v; return true;
    });
    bindOptSeg('boxCornerSeg', v => {
        if (BOX_CORNER_RADIUS[v] === undefined || v === boxCornerStyle) return false;
        boxCornerStyle = v; return true;
    });
    syncOptSegUI();
}

/* 항목 영역 이벤트 위임(입력·서식·삭제·드래그 등) */
function initItemsContainer() {
    const container = document.getElementById('itemsContainer');
    container.addEventListener('input', e => {
        const t = e.target;
        if (t.matches('.btn-input')) {
            if (t.tagName === 'TEXTAREA') autoResizeTextarea(t);
            // 항목명·섹션 제목뿐 아니라 비고·가격 칸까지 타이핑 중 검사한다.
            // (이전에는 포커스·붙여넣기 때만 검사돼 입력 중에는 경고가 뜨지 않았다)
            updateViolationUI(t);
            markBalanceStale();
            debouncedGenerateImages();
            handleInputSnapshot();
        }
    });
    container.addEventListener('mousedown', e => {
        const btn = e.target.closest('.fmt-btn');
        if (!btn) return;
        e.preventDefault();
        const ta = btn.closest('.item-name-wrapper')?.querySelector('.item-name, .section-title-input, .item-note-input');
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
        markBalanceStale();
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
        if (e.target.matches('.btn-input')) setTimeout(() => { updateViolationUI(e.target); markBalanceStale(); saveSnapshot(); }, 0);
    });
    container.addEventListener('click', e => {
        // 내용·구조를 바꾸는 조작이면 균등 맞춤 재정렬 필요 표시
        if (e.target.closest('.js-add-price-slot, .js-dup-price-slot, .js-remove-price-slot, .js-del-section, .js-dup-section, .js-del-item, .js-dup-item, .js-del-colbreak, .js-layout-split, .js-layout-full')) {
            markBalanceStale();
        }
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
                    cols: parseInt(next.dataset.cols, 10) || 1,
                    priceLayout: next.dataset.priceLayout || '',
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
                cols: parseInt(row.dataset.cols, 10) || 1,
                priceLayout: row.dataset.priceLayout || '',
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
                applyColumnTabFilter();   // 전체폭 전환 시 좌측 탭 전용 규칙·안내 배너 즉시 반영
                refreshBookmarks();       // 속성 변경은 MutationObserver가 못 잡으므로 북마크 즉시 갱신
                saveSnapshot(); debouncedGenerateImages();
            }
        }
        // 항목 가로 칸(전체폭/2열/3열) 토글
        if (e.target.closest('.js-itemcol')) {
            const btn = e.target.closest('.js-itemcol');
            const row = btn.closest('.item-row');
            if (row) {
                saveSnapshot();
                const cols = btn.dataset.cols;
                row.dataset.cols = cols;
                row.querySelectorAll('.js-itemcol').forEach(b => b.classList.toggle('item-col-active', b.dataset.cols === cols));
                markBalanceStale();   // 칸 수 변경 → 섹션 높이 변함 → 균형 재정렬 필요 표시
                debouncedGenerateImages();
                handleInputSnapshot();
            }
            return;
        }
        // 가격 배치(나란히/아래로) 토글
        if (e.target.closest('.js-itempl')) {
            const btn = e.target.closest('.js-itempl');
            const row = btn.closest('.item-row');
            if (row) {
                saveSnapshot();
                const pl = btn.dataset.pl;
                row.dataset.priceLayout = pl;
                row.querySelectorAll('.js-itempl').forEach(b => b.classList.toggle('item-col-active', b.dataset.pl === pl));
                markBalanceStale();   // 가격 배치 변경 → 항목 높이 변함 → 균형 재정렬 필요 표시
                debouncedGenerateImages();
                handleInputSnapshot();
            }
            return;
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
        // 섹션 크기 변경은 measureSection 높이를 바꿔 균형에 영향 → 재정렬 필요 표시
        if (e.target.closest('.js-title-size-minus, .js-title-size-plus, .js-body-size-minus, .js-body-size-plus, .js-num-size-minus, .js-num-size-plus')) {
            markBalanceStale();
        }
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
}

/* 색상 프리셋 목록 */
function initColorPresets() {
    renderAllColorPresets();
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
}

/* 리모컨 버튼 · 단축키 */
function initRemote() {
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
}

/* 세션 복원 또는 기본 샘플 + 폰트 로드 후 재렌더 */
function bootstrapContent() {
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
    }
    // 폰트 로딩 완료 후 정확한 메트릭으로 1회 재렌더 (복원·샘플 공통).
    // 폰트가 늦게 로드되면 측정값이 어긋나므로 도착을 기다렸다가 한 번 더 그린다.
    // fonts.ready 는 '실패'도 완료로 보고 이행되므로, 도착 여부까지 확인하는 쪽을 쓴다.
    verifyCanvasFonts();
    applyColumnTabFilter();
    initBookmarkObserver();
    refreshBookmarks();
}

/* 항목 사이 «컬럼 분리» 호버 버튼 */
function initColumnHoverBtn() {
    const container = document.getElementById('itemsContainer');
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
        if (activeColumnTab !== 'all') return;
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

    markSaved();
    // 리모컨은 이제 컨테이너 4번째 그리드 컬럼(sticky)이라 별도 위치 보정 불필요
}

window.onload = () => {
    initTabs();
    initColorPickers();
    initSliders();
    initHeaderFields();
    initImageInputs();
    initItemControls();
    initOptionSegments();
    initItemsContainer();
    initColorPresets();
    initRemote();
    bootstrapContent();
    initColumnHoverBtn();
    markSaved();
};
