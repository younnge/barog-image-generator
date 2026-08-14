/* 렌더 회귀 — 측정과 그리기가 같은 높이를 쓰는지, 로고가 헤더를 밀어내는지.
 *
 * 측정(measureSection)과 그리기(drawSection)가 어긋나면 섹션이 겹치거나
 * 흰 카드 밖으로 삐져나온다. 화면으로만 확인하기 어려운 종류라 수치로 잠근다. */
const assert = require('assert');
const { group, test, report } = require('./helpers/tinytest');
const { createSandbox } = require('./helpers/sandbox');

const env = createSandbox({ canvas: true });
const { sandbox, ctx, draws } = env;
const fonts = { main: 'M', bold: 'B', medium: 'Md', cheoeumcheoreom: 'C' };

const item = (name, pairs, extra = {}) => Object.assign({
    itemName: name, isSublabel: false, cols: 1, priceLayout: '', note: '',
    prices: pairs.map(([label, val]) => ({ label, val })),
}, extra);

const section = (title, items) => ({
    title, titleSize: 24, bodySize: 20, numSize: 35, isFullWidth: false, items,
});

const COL_W = 574;   // 2컬럼 페이지의 한 컬럼 폭

group('측정 / 그리기 높이 일치');

test('단순 섹션', () => {
    const sec = section('보톡스 이벤트', [
        item('이마·미간', [['1회', '4만원'], ['3회', '9만원']]),
        item('사각턱', [['1회', '16만원']]),
    ]);
    const measured = sandbox.measureSection(ctx, sec, COL_W, fonts);
    const drawnEnd = sandbox.drawSection(ctx, sec, 0, 0, COL_W, '#000', '#000', fonts, '#ff0', '#f00', '#000');
    assert.strictEqual(+drawnEnd.toFixed(3), +measured.toFixed(3), `측정 ${measured} vs 그리기 ${drawnEnd}`);
});

test('소제목 · 가격 없는 항목 · 비고가 섞인 섹션', () => {
    const sec = section('혼합', [
        { itemName: '소제목입니다', isSublabel: true, cols: 1, prices: [], note: '' },
        item('가격 없는 항목', []),
        item('비고 있는 항목', [['1회', '10만원']], { note: '부가세 별도' }),
        item('세로배치', [['1회', '10만원'], ['5회', '40만원'], ['10회', '70만원']], { priceLayout: 'stack' }),
    ]);
    const measured = sandbox.measureSection(ctx, sec, COL_W, fonts);
    const drawnEnd = sandbox.drawSection(ctx, sec, 0, 0, COL_W, '#000', '#000', fonts, '#ff0', '#f00', '#000');
    assert.strictEqual(+drawnEnd.toFixed(3), +measured.toFixed(3), `측정 ${measured} vs 그리기 ${drawnEnd}`);
});

test('소제목이 마지막 항목인 섹션 (하단 여백 규칙)', () => {
    const sec = section('끝이 소제목', [
        item('항목', [['1회', '10만원']]),
        { itemName: '마지막 소제목', isSublabel: true, cols: 1, prices: [], note: '' },
    ]);
    const measured = sandbox.measureSection(ctx, sec, COL_W, fonts);
    const drawnEnd = sandbox.drawSection(ctx, sec, 0, 0, COL_W, '#000', '#000', fonts, '#ff0', '#f00', '#000');
    assert.strictEqual(+drawnEnd.toFixed(3), +measured.toFixed(3), `측정 ${measured} vs 그리기 ${drawnEnd}`);
});

test('2·3칸 항목이 섞인 섹션', () => {
    const sec = section('칸 나눔', [
        item('두칸 A', [['1회', '10만원']], { cols: 2 }),
        item('두칸 B', [['5회', '40만원']], { cols: 2 }),
        item('세칸 A', [['1회', '10만원']], { cols: 3 }),
        item('세칸 B', [['5회', '40만원']], { cols: 3 }),
        item('세칸 C', [['10회', '100만원']], { cols: 3 }),
    ]);
    const measured = sandbox.measureSection(ctx, sec, COL_W, fonts);
    const drawnEnd = sandbox.drawSection(ctx, sec, 0, 0, COL_W, '#000', '#000', fonts, '#ff0', '#f00', '#000');
    assert.strictEqual(+drawnEnd.toFixed(3), +measured.toFixed(3), `측정 ${measured} vs 그리기 ${drawnEnd}`);
});

group('가격 그리드 (단위박스 우측 정렬)');

test('여러 줄로 나뉜 가격의 단위박스가 세로로 정렬된다', () => {
    const tiers = [
        { label: '5회', price: '10만원' }, { label: '10회', price: '30만원' },
        { label: '10회', price: '30만원' }, { label: '10회', price: '40만원' },
    ];
    const rows = sandbox.packTierRows(ctx, tiers, 420, 35, fonts);
    assert.ok(rows.length > 1, '여러 줄로 나뉘어야 의미가 있는 검증');
    const grid = sandbox.computeTierGrid(ctx, rows, 35, fonts);
    assert.ok(grid.totalW <= 420, `그리드 폭 ${grid.totalW} 이 칸 폭 420 을 넘지 않아야 함`);
    // 같은 열 번호는 모든 줄에서 같은 폭 → 오른쪽 기준으로 자리가 맞는다
    grid.cols.forEach((c, i) => {
        assert.ok(c.totalW > 0, `${i}번 열 폭이 0 이면 안 됨`);
    });
});

test('4개 가격이 좁은 칸에서는 2×2 를 강요하지 않는다 (잘림 방지)', () => {
    const tiers = [
        { label: '1회', price: '5만원' }, { label: '10회', price: '100만원' },
        { label: '3회', price: '15만원' }, { label: '20회', price: '200만원' },
    ];
    const wide = sandbox.packTierRows(ctx, tiers, 900, 35, fonts);
    const narrow = sandbox.packTierRows(ctx, tiers, 100, 35, fonts);
    assert.strictEqual(wide.length, 2, '넓으면 2×2');
    assert.ok(narrow.length > 2, `좁으면 더 잘게 나눠야 함 (실제 ${narrow.length}줄)`);
    narrow.forEach(r => {
        const g = sandbox.computeTierGrid(ctx, [r], 35, fonts);
        assert.ok(g.totalW <= 100 || r.length === 1, '한 줄이 칸 폭을 넘지 않아야 함');
    });
});

group('로고 · 헤더 밀림');

const H = env.read('CONFIG.H'), W = env.read('CONFIG.W');
const TOP_DEF = env.read('LOGO_TOP_DEFAULT');
const GAP = env.read('LOGO_GAP'), BASE = env.read('LOGO_BASE_H'), MAXW = env.read('LOGO_MAX_W');
const square = env.makeImage(300, 300, 'square');
const wideLogo = env.makeImage(1200, 200, 'wide');
const logoMetrics = env.read('logoMetrics');

const drawPage = (logo, scale, top) => {
    draws.length = 0;
    sandbox.drawA4Canvas(null, [], 0.05, '#000', '#000', '제목', '기간',
        '#000', '비고', '#FFEB3B', '#F00', '#000', false, false, null, logo, scale, top);
    return draws;
};
const bandH = Math.round(H * 0.05);

test('로고 크기 100% 는 기준 높이 그대로', () => {
    const m = logoMetrics(square, 100, TOP_DEF);
    assert.strictEqual(m.h, BASE);
    assert.strictEqual(m.blockH, TOP_DEF + BASE + GAP);
});

test('가로로 긴 로고는 가로 상한에 걸린다', () => {
    const m = logoMetrics(wideLogo, 100, TOP_DEF);
    assert.strictEqual(m.w, MAXW, `가로 ${m.w} 가 상한 ${MAXW} 이어야 함`);
    assert.ok(m.w <= W, '페이지 폭을 넘지 않아야 함');
});

test('로고를 넣으면 제목·기간이 블록 높이만큼 내려간다', () => {
    const noLogo = drawPage(null, 100, TOP_DEF).filter(d => d.kind === 'text').map(d => d.y);
    const withLogo = drawPage(square, 100, TOP_DEF).filter(d => d.kind === 'text').map(d => d.y);
    const m = logoMetrics(square, 100, TOP_DEF);
    const shift = Math.min(...withLogo) - Math.min(...noLogo);
    assert.strictEqual(shift, m.blockH, `밀린 거리 ${shift} 가 블록 높이 ${m.blockH} 와 같아야 함`);
});

test('세로 위치를 키우면 로고와 제목이 함께 내려간다', () => {
    for (const top of [0, 26, 120, 250]) {
        const d = drawPage(square, 100, top);
        const img = d.find(x => x.kind === 'img');
        const ys = d.filter(x => x.kind === 'text').map(x => x.y).sort((a, b) => a - b);
        const m = logoMetrics(square, 100, top);
        assert.strictEqual(img.a[1], top, `위치 ${top}: 로고 y`);
        assert.strictEqual(ys[0], bandH + m.blockH - 40, `위치 ${top}: 제목 baseline`);
    }
});

test('로고는 가로 가운데 정렬된다', () => {
    const img = drawPage(square, 150, TOP_DEF).find(d => d.kind === 'img');
    assert.strictEqual(img.a[0] + img.a[2] / 2, W / 2);
});

test('헤더 높이 0% 면 로고만 나오고 제목·기간은 빠진다', () => {
    draws.length = 0;
    sandbox.drawA4Canvas(null, [], 0, '#000', '#000', '제목', '기간',
        '#000', '비고', '#FFEB3B', '#F00', '#000', false, false, null, square, 100, TOP_DEF);
    assert.strictEqual(draws.filter(d => d.kind === 'text').length, 0, '텍스트 없음');
    assert.strictEqual(draws.filter(d => d.kind === 'img').length, 1, '로고는 그려짐');
});

test('로고 세로 위치는 범위를 벗어나면 잘린다', () => {
    const MIN = env.read('LOGO_TOP_MIN'), MAX = env.read('LOGO_TOP_MAX');
    assert.strictEqual(logoMetrics(square, 100, -50).top, MIN);
    assert.strictEqual(logoMetrics(square, 100, 9999).top, MAX);
    // Number(null) 은 NaN 이 아니라 0 이라 기본값이 0 으로 덮이는 함정이 있었다
    assert.strictEqual(logoMetrics(square, 100, null).top, TOP_DEF, 'null → 기본값');
    assert.strictEqual(logoMetrics(square, 100, 'abc').top, TOP_DEF, '숫자 아님 → 기본값');
});

test('로고가 없으면 헤더가 늘어나지 않는다', () => {
    assert.strictEqual(logoMetrics(null, 100, TOP_DEF), null);
    assert.strictEqual(sandbox.logoBlockHeight(null, 100, TOP_DEF), 0);
});

if (require.main === module) process.exit(report('render'));
