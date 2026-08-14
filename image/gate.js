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
// ⚠ 임시 암호입니다. 배포 후 바로 바꾸세요 — 이 값은 대화·커밋 기록에 남아 있습니다.
const GATE_HASH = '8fb3990801223cea028e8f81aa2cdf797c15a9ccdb9d8e3be86b36416465b5ba';
const GATE_KEY = 'a4GateOk';

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
    if (saved === GATE_HASH) { gateOpen(); return; }

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
        try { localStorage.setItem(GATE_KEY, hash); } catch (e) { /* 저장 실패해도 이번 방문은 통과 */ }
        if (error) error.textContent = '';
        gateOpen();
    });
}

document.addEventListener('DOMContentLoaded', initGate);
