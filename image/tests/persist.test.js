/* 저장 · 복원 — 백업과 세션이 설정을 온전히 실어 나르는지, 그리고
 * 편집마다 이미지를 다시 쓰던 낭비가 재발하지 않는지. */
const assert = require('assert');
const { group, test, finish } = require('./helpers/tinytest');
const { createSandbox } = require('./helpers/sandbox');

const env = createSandbox({ dom: true, storage: true });
const { sandbox } = env;

// restoreSnapshot 이 만지는 최소 요소만 준비한다(없으면 null 가드로 조용히 넘어간다)
env.addElement('itemsContainer');
['topText', 'periodText', 'periodNote'].forEach(id => env.addElement(id, 'textarea', ['btn-input']));

group('설정 복원');

test('로고 크기·세로 위치는 범위를 벗어나면 잘린다', () => {
    const SMIN = env.read('LOGO_SCALE_MIN'), SMAX = env.read('LOGO_SCALE_MAX');
    const TMIN = env.read('LOGO_TOP_MIN'), TMAX = env.read('LOGO_TOP_MAX');
    sandbox.restoreSnapshot({ items: [], logoScale: 999, logoTop: 999 });
    assert.strictEqual(env.read('logoSizePct'), SMAX);
    assert.strictEqual(env.read('logoTopPad'), TMAX);
    sandbox.restoreSnapshot({ items: [], logoScale: -5, logoTop: -5 });
    assert.strictEqual(env.read('logoSizePct'), SMIN);
    assert.strictEqual(env.read('logoTopPad'), TMIN);
});

test('없던 항목은 기본값으로 복원된다 (구버전 백업 호환)', () => {
    sandbox.restoreSnapshot({ items: [] });
    assert.strictEqual(env.read('logoSizePct'), env.read('LOGO_SCALE_DEFAULT'));
    assert.strictEqual(env.read('logoTopPad'), env.read('LOGO_TOP_DEFAULT'));
    assert.strictEqual(env.read('boxCornerStyle'), 'round');
    assert.strictEqual(env.read('itemDividerStyle'), 'solid');
});

test('페이지 배치 상태가 왕복한다', () => {
    sandbox.restoreSnapshot({ items: [], balanced: true, bottomExact: true });
    assert.strictEqual(sandbox.currentPageLayout(), 'exact');
    sandbox.restoreSnapshot({ items: [], balanced: true, bottomExact: false });
    assert.strictEqual(sandbox.currentPageLayout(), 'balance');
    sandbox.restoreSnapshot({ items: [], balanced: false });
    assert.strictEqual(sandbox.currentPageLayout(), 'none');
});

test('좌·우 간격 묶기는 구버전 백업에서 값이 같을 때만 묶인 것으로 본다', () => {
    sandbox.restoreSnapshot({ items: [], sectionGap: '15', sectionGapRight: '15' });
    assert.strictEqual(env.read('gapLinked'), true, '같은 값 → 묶임');
    sandbox.restoreSnapshot({ items: [], sectionGap: '15', sectionGapRight: '30' });
    assert.strictEqual(env.read('gapLinked'), false, '다른 값 → 풀림');
    sandbox.restoreSnapshot({ items: [], gapLinked: true, sectionGap: '15', sectionGapRight: '30' });
    assert.strictEqual(env.read('gapLinked'), true, '명시값이 우선');
});

test('문서 언어는 복원하지 않는다 (문구로 자동 판별하므로)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
    assert.ok(!/data\.docLang/.test(src), 'restoreSnapshot 이 저장된 docLang 을 읽으면 안 됨');
});

group('세션 이미지 기록 억제');

const imgWrites = () => env.writes.filter(w => w.key === 'a4BgImage' || w.key === 'a4LogoImage').length;
const bodyWrites = () => env.writes.filter(w => w.key === 'a4EventData').length;

test('같은 배경은 편집을 반복해도 한 번만 기록한다', () => {
    env.setQuota(Infinity);
    env.write('cachedBgImg', env.makeDataImage(1, 'A'));
    env.resetWrites();
    for (let i = 0; i < 10; i++) sandbox.saveToSessionStorage({ items: [] });
    assert.strictEqual(imgWrites(), 1, `이미지 기록 ${imgWrites()}회`);
    assert.strictEqual(bodyWrites(), 10, '본문 스냅샷은 매번 기록되어야 함');
});

test('배경을 바꾸면 다시 기록한다', () => {
    env.write('cachedBgImg', env.makeDataImage(1, 'B'));
    env.resetWrites();
    for (let i = 0; i < 5; i++) sandbox.saveToSessionStorage({ items: [] });
    assert.strictEqual(imgWrites(), 1);
});

test('지웠다 같은 배경을 다시 넣으면 기록한다', () => {
    const same = env.makeDataImage(1, 'C');
    env.write('cachedBgImg', same);
    sandbox.saveToSessionStorage({ items: [] });
    sandbox.clearSessionBg();
    env.write('cachedBgImg', same);
    env.resetWrites();
    sandbox.saveToSessionStorage({ items: [] });
    assert.strictEqual(imgWrites(), 1, '추적 상태가 초기화되지 않으면 0 이 된다');
});

test('용량을 넘겨도 안내는 이미지당 한 번만 뜬다', () => {
    env.setQuota(4 * 1048576);
    env.write('cachedBgImg', null);
    sandbox.clearSessionBg();
    env.write('cachedBgImg', env.makeDataImage(6, 'D'));
    env.resetWrites();
    for (let i = 0; i < 10; i++) sandbox.saveToSessionStorage({ items: [] });
    const notices = env.toasts.filter(t => t.includes('배경'));
    assert.strictEqual(notices.length, 1, `안내 ${notices.length}회 (편집 10회)`);
    assert.strictEqual(imgWrites(), 1, `재시도 ${imgWrites()}회`);
});

test('안내 문구가 결과와 대처법을 함께 알린다', () => {
    env.setQuota(4 * 1048576);
    env.write('cachedBgImg', null);
    sandbox.clearSessionBg();
    env.write('cachedBgImg', env.makeDataImage(6, 'E'));
    env.resetWrites();
    sandbox.saveToSessionStorage({ items: [] });
    const msg = env.toasts.find(t => t.includes('배경')) || '';
    assert.ok(/새로고침하면 사라집니다/.test(msg), '결과를 알려야 함: ' + msg);
    assert.ok(/저장 버튼으로 백업/.test(msg), '대처법을 알려야 함: ' + msg);
});

if (require.main === module) finish('persist');
