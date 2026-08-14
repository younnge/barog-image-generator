/* 캔버스 웹폰트 도착 확인.
 *
 * 이 폰트들은 DOM 에서 안 쓰이고 ctx.font 로만 쓰인다. 못 받으면 대체 글꼴로 조용히
 * 그려지고, 미리보기도 똑같이 잘못 보이므로 화면만으로는 알아채기 어렵다.
 * 그래서 (1) 명시적으로 요청하고 (2) 도착 여부를 확인하고 (3) 실패를 알린다.
 * 여기서 잠그는 것은 그 세 갈래와, '헛경보를 내지 않는가' 이다. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { group, test, finish } = require('./helpers/tinytest');
const { createSandbox } = require('./helpers/sandbox');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

/* decide(spec) 로 폰트별 결과를 정한다: 'ok' | 'empty'(일치하는 face 없음) | 'reject'(네트워크 실패) */
function setup(decide = () => 'ok') {
    const s = createSandbox({ canvas: true });
    s.addElement('fontWarn', 'div');
    s.sandbox.document.fonts.load = spec => {
        const r = decide(String(spec));
        if (r === 'reject') return Promise.reject(new Error('network'));
        return Promise.resolve(r === 'empty' ? [] : [{ family: String(spec) }]);
    };
    // 실패 시나리오가 많아 앱 로그가 테스트 출력을 덮는다 — 샌드박스 콘솔만 죽인다
    s.sandbox.console = { log() {}, warn() {}, error() {} };
    // 렌더 호출 횟수만 센다 — 실제 그리기 검증은 render.test.js 담당
    s.sandbox.__renders = 0;
    s.read('generateImages = function () { __renders++; }');
    return s;
}

const warnEl = s => s.els.fontWarn;

group('확인 대상 구성');

test('한국어 핵심 4종이 spec·sample·label 을 갖춘다', () => {
    const list = createSandbox().read('CANVAS_WEBFONTS');
    assert.strictEqual(list.length, 4, `4종이어야 함 (현재 ${list.length})`);
    list.forEach(f => {
        assert.ok(/^\d+ \d+px '.+'$/.test(f.spec), `spec 형식이 이상함: ${f.spec}`);
        assert.ok(f.sample && f.sample.length, `sample 이 없음: ${f.spec}`);
        assert.ok(f.label && f.label.length, `label 이 없음: ${f.spec}`);
    });
    const labels = list.map(f => f.label);
    assert.strictEqual(new Set(labels).size, labels.length, `라벨이 겹침: ${labels.join(',')}`);
});

test('두 CDN 을 모두 대표한다 (한쪽만 죽어도 잡히게)', () => {
    const specs = createSandbox().read('CANVAS_WEBFONTS').map(f => f.spec).join(' ');
    // Paperlogy = cdn.jsdelivr.net, GmarketSans = fastly.jsdelivr.net
    assert.ok(/Paperlogy/.test(specs), 'Paperlogy 가 빠짐');
    assert.ok(/GmarketSans/.test(specs), 'GmarketSans 가 빠짐');
});

test('Noto 는 확인 대상에서 뺀다 (서브셋이라 헛경보가 난다)', () => {
    const specs = createSandbox().read('CANVAS_WEBFONTS').map(f => f.spec).join(' ');
    assert.ok(!/Noto/.test(specs),
        'Noto 는 유니코드 서브셋으로 들어와 안 받은 것과 못 받은 것을 구분할 수 없다');
});

group('도착 판정');

test('전부 도착하면 미수신 목록이 비어 있다', () => {
    const s = setup(() => 'ok');
    return s.sandbox.loadCanvasWebfonts().then(missing => {
        assert.strictEqual(missing.join('|'), '', `헛경보: ${missing.join(',')}`);
    });
});

test('빈 배열이 오면 미수신으로 센다 (@font-face 자체를 못 받은 경우)', () => {
    const s = setup(spec => (spec.includes('GmarketSansBold') ? 'empty' : 'ok'));
    return s.sandbox.loadCanvasWebfonts().then(missing => {
        assert.strictEqual(missing.join('|'), '금액');
    });
});

test('요청이 실패해도 미수신으로 센다', () => {
    const s = setup(spec => (spec.includes('Paperlogy') ? 'reject' : 'ok'));
    return s.sandbox.loadCanvasWebfonts().then(missing => {
        assert.strictEqual(missing.sort().join('|'), '본문|제목');
    });
});

test('하나가 실패해도 나머지를 끝까지 확인한다', () => {
    const s = setup(spec => (spec.includes('Paperlogy') ? 'reject' : 'empty'));
    return s.sandbox.loadCanvasWebfonts().then(missing => {
        assert.strictEqual(missing.length, 4, `4종 모두 잡혀야 함 (현재 ${missing.join(',')})`);
    });
});

test('fonts.load 를 지원하지 않는 브라우저에서는 경고하지 않는다', () => {
    const s = setup();
    delete s.sandbox.document.fonts.load;
    return s.sandbox.loadCanvasWebfonts().then(missing => {
        assert.strictEqual(missing.join('|'), '', '확인할 수 없는 것과 실패한 것은 다르다');
    });
});

group('안내 배너');

test('미수신이 없으면 숨긴다', () => {
    const s = setup();
    s.sandbox.setFontWarn([]);
    assert.strictEqual(warnEl(s).hidden, true);
    assert.strictEqual(warnEl(s).textContent, '');
});

test('미수신 이름과 조치 방법을 함께 알린다', () => {
    const s = setup();
    s.sandbox.setFontWarn(['본문', '금액']);
    const el = warnEl(s);
    assert.strictEqual(el.hidden, false, '배너가 보여야 함');
    assert.ok(el.textContent.includes('본문') && el.textContent.includes('금액'), '어떤 글꼴인지 밝혀야 함');
    assert.ok(el.textContent.includes('새로고침'), '무엇을 하라는지 없으면 안내가 아니다');
    assert.ok(/인쇄물|글자 모양/.test(el.textContent), '왜 문제인지가 있어야 사용자가 판단한다');
});

test('경고가 렌더 경고(setFloatingWarn)와 서로를 지우지 않는다', () => {
    const s = setup();
    s.addElement('floatingWarn', 'div');
    s.sandbox.setFontWarn(['본문']);
    s.sandbox.setFloatingWarn('');            // 렌더마다 호출되는 초기화
    assert.strictEqual(warnEl(s).hidden, false, '렌더 한 번에 폰트 경고가 지워지면 안 됨');
    s.sandbox.setFloatingWarn('⚠ 내용이 넘쳐 일부가 잘렸습니다');
    assert.strictEqual(warnEl(s).hidden, false, '다른 경고가 폰트 경고를 덮으면 안 됨');
});

group('전체 흐름');

test('정상일 때 경고 없이 재렌더한다', () => {
    const s = setup(() => 'ok');
    return s.sandbox.verifyCanvasFonts().then(() => {
        assert.strictEqual(warnEl(s).hidden, true, '멀쩡한데 경고가 떴음');
        assert.strictEqual(s.sandbox.__renders, 1, '폰트 도착 후 정확한 메트릭으로 1회 그려야 함');
    });
});

test('폰트를 못 받아도 렌더는 반드시 한다', () => {
    const s = setup(() => 'reject');
    return s.sandbox.verifyCanvasFonts().then(() => {
        assert.strictEqual(s.sandbox.__renders, 1, '대체 글꼴로라도 보여야 한다 — 빈 화면은 더 나쁘다');
        assert.strictEqual(warnEl(s).hidden, false, '실패했는데 조용하면 이 기능의 존재 이유가 없다');
    });
});

test('확인 중 예기치 못한 오류가 나도 렌더는 한다', () => {
    const s = setup();
    s.read('loadCanvasWebfonts = function () { return Promise.reject(new Error("boom")); }');
    return s.sandbox.verifyCanvasFonts().then(() => {
        assert.strictEqual(s.sandbox.__renders, 1);
    });
});

group('배선');

test('index.html 에 배너 자리가 있고 기본은 숨김이다', () => {
    const el = /<div id="fontWarn"[^>]*>/.exec(HTML);
    assert.ok(el, '#fontWarn 이 없음');
    assert.ok(/hidden/.test(el[0]), '기본이 노출이면 멀쩡한 상태에서도 경고가 보인다');
    assert.ok(/role="alert"/.test(el[0]), '보조기기에 알려야 함');
});

test('부팅이 fonts.ready 가 아니라 도착 확인을 쓴다', () => {
    assert.ok(/verifyCanvasFonts\(\);/.test(APP), 'bootstrap 에서 호출되지 않음');
    assert.ok(!/document\.fonts\.ready\.then\(\(\) => generateImages\(\)\)/.test(APP),
        'fonts.ready 는 실패해도 이행되므로 도착 확인을 대체할 수 없다');
});

if (require.main === module) finish('font');
