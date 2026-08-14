/* 진입 암호 — 맞으면 열리고 틀리면 안 열리는지, 기억이 제대로 되는지.
 *
 * 이 게이트는 '우연한 접근'을 막는 커튼이지 실제 접근 제어가 아니다.
 * 그래도 최소한 제 역할은 해야 하므로 통과·차단·기억 세 갈래를 잠근다. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { group, test, report } = require('./helpers/tinytest');
const { makeElement } = require('./helpers/sandbox');

const GATE = fs.readFileSync(path.join(__dirname, '..', 'gate.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const SALT = /const GATE_SALT = '([^']+)'/.exec(GATE)[1];
const HASH = /const GATE_HASH = '([0-9a-f]{64})'/.exec(GATE)[1];
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* gate.js 를 브라우저 흉내 컨텍스트에서 돌리고, 열림 여부를 돌려준다. */
function runGate({ saved = null, typed = null } = {}) {
    const store = saved === null ? {} : { a4GateOk: saved };
    const els = {
        gate: makeElement('div', 'gate'),
        gateInput: makeElement('input', 'gateInput'),
        gateForm: makeElement('form', 'gateForm'),
        gateError: makeElement('p', 'gateError'),
    };
    const bodyCls = new Set();
    let domReady = null;
    const sandbox = {
        console, Math, JSON, String, Array, Object, Uint8Array, Promise, Error,
        TextEncoder,
        crypto: {
            subtle: {
                async digest(_alg, bytes) {
                    const h = crypto.createHash('sha256').update(Buffer.from(bytes)).digest();
                    return h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength);
                },
            },
        },
        localStorage: {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
        },
        document: {
            getElementById: id => els[id] || null,
            addEventListener: (t, fn) => { if (t === 'DOMContentLoaded') domReady = fn; },
            body: { classList: { add: c => bodyCls.add(c), remove: c => bodyCls.delete(c) } },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(GATE, sandbox);
    domReady();

    const submit = async () => {
        els.gateInput.value = typed;
        const handler = els.gateForm._listeners.submit[0];
        await handler({ preventDefault() {} });
    };
    return {
        opened: () => els.gate.hidden === true,
        locked: () => bodyCls.has('gate-locked'),
        error: () => els.gateError.textContent,
        store, submit, els,
    };
}

group('암호 확인');

test('맞는 암호를 넣으면 열린다', async () => {
    // 테스트는 해시만 알고 암호는 모른다 — 해시가 곧 정답이므로 역산 대신 동일 규칙으로 만든다
    const pw = 'barog-2026-임시암호';
    assert.strictEqual(sha(SALT + ':' + pw), HASH, '샘플 암호가 현재 해시와 맞아야 이 테스트가 의미 있음');
    const g = runGate({ typed: pw });
    assert.ok(!g.opened(), '입력 전에는 잠겨 있어야 함');
    await g.submit();
    assert.ok(g.opened(), '맞는 암호인데 열리지 않음');
    assert.strictEqual(g.error(), '');
});

test('틀린 암호는 열지 못한다', async () => {
    const g = runGate({ typed: '아무거나' });
    await g.submit();
    assert.ok(!g.opened(), '틀린 암호로 열렸음');
    assert.ok(g.error().includes('맞지 않습니다'), '오류 안내가 없음: ' + g.error());
});

test('빈 입력은 아무 일도 하지 않는다', async () => {
    const g = runGate({ typed: '' });
    await g.submit();
    assert.ok(!g.opened());
    assert.strictEqual(g.error(), '');
});

group('기억');

test('통과하면 다음 방문에는 묻지 않는다', async () => {
    const g = runGate({ typed: 'barog-2026-임시암호' });
    await g.submit();
    assert.strictEqual(g.store.a4GateOk, HASH, '통과 표시가 저장되어야 함');
    const again = runGate({ saved: HASH });
    assert.ok(again.opened(), '저장된 표시가 있는데 다시 물어봄');
});

test('암호를 바꾸면 기존 표시는 무효가 된다', () => {
    const g = runGate({ saved: 'a'.repeat(64) });   // 예전 해시
    assert.ok(!g.opened(), '옛 표시로 통과되면 암호 변경이 무의미해짐');
});

group('잠금 상태 표시');

test('잠겨 있는 동안 뒤 화면 스크롤을 막는다', () => {
    const g = runGate({});
    assert.ok(g.locked(), 'body 에 gate-locked 가 붙어야 함');
});

test('열리면 잠금 표시가 풀린다', async () => {
    const g = runGate({ typed: 'barog-2026-임시암호' });
    await g.submit();
    assert.ok(!g.locked());
});

group('마크업 · 걷어내기 용이성');

test('오버레이가 HTML 에 기본 노출된다 (JS 꺼져도 닫힌 채 유지)', () => {
    const gateEl = /<div class="gate" id="gate"[^>]*>/.exec(HTML);
    assert.ok(gateEl, '#gate 블록이 없음');
    assert.ok(!/hidden/.test(gateEl[0]), 'hidden 이 기본이면 JS 실패 시 그냥 열려버린다');
});

test('gate.js 가 main.js 보다 먼저 로드된다', () => {
    assert.ok(HTML.indexOf('gate.js') < HTML.indexOf('main.js'), '순서가 뒤바뀜');
});

test('걷어낼 지점이 한곳에 모여 있다', () => {
    const CSS = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
    assert.ok(/진입 암호/.test(CSS), 'style.css 에 표시된 구역이 있어야 함');
    assert.ok(/Cloudflare Access/.test(GATE), 'gate.js 에 이전 안내가 있어야 함');
});

if (require.main === module) process.exit(report('gate'));
