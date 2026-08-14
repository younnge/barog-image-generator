/* 의료법 위반어 감지 — 이 앱이 존재하는 이유에 직접 걸린 기능.
 * 검사에서 빠진 입력칸이 있으면 금지어가 그대로 인쇄되므로 배선까지 확인한다. */
const assert = require('assert');
const { group, test, report } = require('./helpers/tinytest');
const { createSandbox } = require('./helpers/sandbox');

const env = createSandbox({ dom: true });
const { sandbox } = env;

group('감지 · 대체어');

test('금지어를 찾고 대체어를 제안한다', () => {
    const v = sandbox.checkMedicalLaw('신데렐라주사 이벤트');
    assert.ok(v.some(x => x.word === '신데렐라주사' && x.replacement === '티옥트산주사'));
});

test('예외어는 오탐하지 않는다', () => {
    const v = sandbox.checkMedicalLaw('엑토좀PTT 관리');
    assert.ok(!v.some(x => x.word === '엑토좀' || x.word === '엑소좀'));
});

test('위반이 없으면 빈 배열', () => {
    assert.strictEqual(sandbox.checkMedicalLaw('보톡스 이벤트').length, 0);
});

group('검사 대상 입력칸');

const HEADER_IDS = ['topText', 'periodText', 'periodNote'];
const els = {};
HEADER_IDS.forEach(id => { els[id] = env.addElement(id, id === 'topText' ? 'textarea' : 'input', ['btn-input']); });
env.addElement('itemsContainer');

const BAD = '신데렐라주사 이벤트';
const flagged = el => el.classList.contains('violation-input');
const tipCount = () => env.bodyNodes.filter(n => n.classList.contains('violation-tooltip')).length;

HEADER_IDS.forEach(id => {
    test(`${id} — 금지어를 입력하면 경고가 뜬다`, () => {
        const el = els[id];
        sandbox.wireViolationCheck(el);
        el.value = BAD;
        el.fire('input');
        assert.ok(flagged(el), '경고 표시가 없음 — 이 칸이 검사에서 빠져 있다');
    });
});

test('금지어를 지우면 경고와 툴팁이 함께 사라진다', () => {
    HEADER_IDS.forEach(id => {
        els[id].value = '보톡스 이벤트';
        els[id].fire('input');
        assert.ok(!flagged(els[id]), id);
    });
    assert.strictEqual(tipCount(), 0);
});

group('복원 후 유령 경고');

test('되돌리기로 값이 바뀌면 이전 경고가 남지 않는다', () => {
    els.topText.value = BAD;
    els.topText.fire('input');
    assert.ok(flagged(els.topText), '사전 조건: 경고가 켜져 있어야 함');
    sandbox.restoreSnapshot({ items: [], topText: '보톡스 이벤트', periodText: '', periodNote: '' });
    assert.ok(!flagged(els.topText), '값이 바뀌었는데 경고가 남아 있음');
    assert.strictEqual(els.topText.getAttribute('data-last-violation'), null);
    assert.strictEqual(tipCount(), 0, '툴팁이 남아 있음');
});

test('복원한 값 자체가 금지어면 경고가 켜진다', () => {
    sandbox.restoreSnapshot({ items: [], topText: BAD, periodText: '', periodNote: '' });
    assert.ok(flagged(els.topText));
});

group('스크롤 시 툴팁 해제');

test('툴팁을 닫으면 주인의 참조까지 정리된다', () => {
    els.topText.value = BAD;
    els.topText.fire('input');
    assert.strictEqual(tipCount(), 1, '사전 조건: 툴팁이 떠 있어야 함');
    sandbox.dismissViolationTooltips();
    assert.strictEqual(tipCount(), 0, '툴팁이 남음');
    assert.strictEqual(els.topText._violTooltip, null, '참조가 남음');
    assert.strictEqual(els.topText.getAttribute('data-last-violation'), null,
        '표식이 남으면 다시 띄울 수 없다');
});

test('닫은 뒤 다시 입력하면 툴팁이 되살아난다', () => {
    els.topText.fire('input');
    assert.strictEqual(tipCount(), 1);
    sandbox.dismissViolationTooltips();
});

if (require.main === module) process.exit(report('violation'));
