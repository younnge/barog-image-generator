/* ============================================================
 * 진입 암호 (사내 전용 표시용)
 * ============================================================
 * 무엇을 하는가 — 링크를 우연히 받은 사람이 그냥 들어와 쓰는 것을 막는다.
 * 무엇을 못 하는가 — 저장소가 공개라 이 파일과 해시가 그대로 보이고,
 *   main.js 도 인증 없이 내려받을 수 있다. 작정한 사람은 우회한다.
 *   실제 접근 제어가 필요해지면 Cloudflare Access 같은 인증 게이트를 앞에 두고
 *   이 파일 · index.html 의 #gate 블록 · style.css 의 '진입 암호' 구역만 지우면 된다.
 *
 * 암호 변경:  node tools/set-password.js "새암호"  → 출력된 GATE_HASH 로 교체
 */
const GATE_SALT = 'barog-image-generator';   // 레인보우 테이블 무력화용 — 비밀이 아님
const GATE_HASH = '60b6edb98a5bd2ced6b5b8cc3f8e6e5e1e9d0268d110d6691358cf9863ffe36a';
const GATE_KEY = 'a4GateOk';

/* 한 번 통과한 컴퓨터에서 언제 다시 물을지.
 *   'forever' — 다시 묻지 않는다(기본). 브라우저 데이터를 지우거나 암호를 바꿀 때만 재입력.
 *   'daily'   — 날짜가 바뀌면 그날 첫 접속에 한 번만 묻는다. 그 뒤 재접속·새로고침은 통과.
 * 여러 사람이 한 PC 를 돌려 쓰는 자리라면 'daily' 가 낫다. */
const GATE_REMEMBER = 'forever';

/* 오늘 날짜(로컬 기준) — 'daily' 모드에서 통과 기록과 비교한다. */
function gateToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* 저장된 통과 기록이 아직 유효한가.
 * 암호가 바뀌면 해시가 달라져 자동으로 무효가 된다(모드와 무관). */
function gateRecordValid(raw) {
    if (!raw) return false;
    let rec;
    try { rec = JSON.parse(raw); } catch (e) { return false; }   // 옛 형식(해시 문자열)은 버린다
    if (!rec || rec.h !== GATE_HASH) return false;
    if (GATE_REMEMBER === 'daily') return rec.d === gateToday();
    return true;
}

async function gateDigest(text) {
    const bytes = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function gateOpen() {
    const gate = document.getElementById('gate');
    if (gate) gate.hidden = true;
    document.body.classList.remove('gate-locked');
}

function initGate() {
    const gate = document.getElementById('gate');
    if (!gate) return;
    const input = document.getElementById('gateInput');
    const form = document.getElementById('gateForm');
    const error = document.getElementById('gateError');

    // 이미 통과한 브라우저는 그대로 통과. 암호를 바꾸면 해시가 달라져 다시 물어본다.
    let saved = null;
    try { saved = localStorage.getItem(GATE_KEY); } catch (e) { /* 저장 차단 브라우저 */ }
    if (gateRecordValid(saved)) { gateOpen(); return; }

    document.body.classList.add('gate-locked');
    input?.focus();

    form?.addEventListener('submit', async e => {
        e.preventDefault();
        const value = input.value;
        if (!value) return;
        let hash;
        try {
            hash = await gateDigest(GATE_SALT + ':' + value);
        } catch (err) {
            // crypto.subtle 은 보안 컨텍스트(https·localhost)에서만 동작한다
            if (error) error.textContent = '이 주소에서는 확인할 수 없습니다 — https 주소로 접속해 주세요.';
            return;
        }
        if (hash !== GATE_HASH) {
            if (error) error.textContent = '암호가 맞지 않습니다.';
            input.value = '';
            input.focus();
            gate.classList.remove('gate-shake');
            void gate.offsetWidth;          // 애니메이션 재시작
            gate.classList.add('gate-shake');
            return;
        }
        // 통과 기록 = 해시 + 통과한 날짜. 해시로 암호 변경을, 날짜로 'daily' 만료를 판단한다.
        try {
            localStorage.setItem(GATE_KEY, JSON.stringify({ h: hash, d: gateToday() }));
        } catch (e) { /* 저장 실패해도 이번 방문은 통과 — 다음 접속에 다시 묻는다 */ }
        if (error) error.textContent = '';
        gateOpen();
    });
}

document.addEventListener('DOMContentLoaded', initGate);
