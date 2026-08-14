/* 초기화 배선 스모크 — window.onload 가 끝까지 도는지.
 *
 * 이 파일의 목적은 기능 검증이 아니라 '깨지지 않고 배선되는가' 다.
 * 초기화 코드를 여러 함수로 쪼갤 때 스코프를 넘는 참조가 생기면
 * node --check 로는 못 잡고 실행 시 ReferenceError 가 난다 — 그것을 여기서 잡는다. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { group, test, finish } = require('./helpers/tinytest');
const { createSandbox } = require('./helpers/sandbox');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const HTML_IDS = [...new Set([...HTML.matchAll(/id="([^"]+)"/g)].map(m => m[1]))];

group('window.onload 배선');

test('예외 없이 끝까지 실행된다', () => {
    const env = createSandbox({ canvas: true, dom: true, autoCreate: true });
    assert.strictEqual(typeof env.sandbox.window.onload, 'function',
        'window.onload 가 함수로 등록되어야 함');
    env.sandbox.window.onload();   // 던지면 테스트 실패
});

test('index.html 의 모든 id 가 조회 가능하다 (오타·누락 배선 탐지)', () => {
    const env = createSandbox({ canvas: true, dom: true, autoCreate: true });
    env.sandbox.window.onload();
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const refs = [...new Set([...src.matchAll(/getElementById\('([A-Za-z]\w*)'\)/g)].map(m => m[1]))];
    // 동적으로 만들어 붙이는 두 요소만 HTML 에 없어도 정상이다
    const DYNAMIC = new Set(['colorToast', 'itemsEmptyHint']);
    const missing = refs.filter(r => !HTML_IDS.includes(r) && !DYNAMIC.has(r));
    assert.strictEqual(missing.length, 0, 'HTML 에 없는 id 참조: ' + missing.join(', '));
});

test('초기화 후 핵심 상태가 기본값이다', () => {
    const env = createSandbox({ canvas: true, dom: true, autoCreate: true });
    env.sandbox.window.onload();
    assert.strictEqual(env.read('gapLinked'), true, '좌·우 간격은 기본이 묶임');
    assert.strictEqual(env.read('boxCornerStyle'), 'round');
    assert.strictEqual(env.read('itemDividerStyle'), 'solid');
    assert.strictEqual(env.read('layoutBalanced'), false);
    assert.strictEqual(env.read('logoSizePct'), env.read('LOGO_SCALE_DEFAULT'));
    assert.strictEqual(env.read('logoTopPad'), env.read('LOGO_TOP_DEFAULT'));
});

test('초기화를 두 번 돌려도 예외가 없다 (리스너 중복 배선 안전성)', () => {
    const env = createSandbox({ canvas: true, dom: true, autoCreate: true });
    env.sandbox.window.onload();
    env.sandbox.window.onload();
});

group('초기화 구성');

test('초기화가 이름 있는 단계로 나뉘어 있다', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const lines = src.split('\n');
    const start = lines.findIndex(l => l.startsWith('window.onload'));
    assert.ok(start >= 0, 'window.onload 를 찾지 못함');
    let depth = 0, started = false, end = start;
    for (let i = start; i < lines.length; i++) {
        depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
        if (lines[i].includes('{')) started = true;
        if (started && depth <= 0) { end = i; break; }
    }
    const size = end - start + 1;
    assert.ok(size <= 120, `window.onload 가 ${size}줄 — 단계별 함수로 나눠야 함(상한 120줄)`);
});

if (require.main === module) finish('init');
