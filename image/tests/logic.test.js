/* 순수 로직 회귀 테스트 (DOM/canvas 불필요).
 * 실행: node tests/logic.test.js   (외부 의존성 없음 — Node 내장 vm/assert/fs만 사용)
 *
 * main.js 는 클래식 스크립트(전역 함수 선언)이므로 vm 샌드박스에서 평가한 뒤
 * 캔버스가 필요 없는 순수 함수만 골라 검증한다. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
// 최상위에서 참조하는 브라우저 전역만 최소 스텁(함수 본문은 실행되지 않음)
const sandbox = {
    window: {}, document: {}, console, Math, JSON, String, Array, RegExp, Object,
    parseInt, parseFloat, Set, Map, Uint8Array, isNaN
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const textOf = chunks => chunks.map(c => c.text).join('');

console.log('DSL 파서 (서식 토큰)');
test('일반 텍스트는 그대로 보존', () => {
    assert.strictEqual(textOf(sandbox.parseStyledText('아쿠아필(블랙헤드)')), '아쿠아필(블랙헤드)');
});
test('짝 없는 > 뒤 텍스트 유실 방지 (회귀)', () => {
    assert.strictEqual(textOf(sandbox.parseStyledText('효과>이전')), '효과>이전');
});
test('짝 없는 } 뒤 텍스트 유실 방지', () => {
    assert.strictEqual(textOf(sandbox.parseStyledText('A}B')), 'A}B');
});
test('정상 강조 토큰 <..>는 내용 보존 + 하이라이트 플래그', () => {
    const c = sandbox.parseStyledText('정상<강조>끝');
    assert.strictEqual(textOf(c), '정상강조끝');
    assert.ok(c.some(ch => ch.isHighlight && ch.text === '강조'));
});
test('굵게 토큰 {..} 내용 보존 + boldLevel 증가', () => {
    const c = sandbox.parseStyledText('a{굵게}b');
    assert.strictEqual(textOf(c), 'a굵게b');
    assert.ok(c.some(ch => ch.boldLevel >= 1 && ch.text === '굵게'));
});
test('크기 확대 <+..+> 내용 보존 + sizeDelta>0', () => {
    const c = sandbox.parseStyledText('x<+크게+>y');
    assert.strictEqual(textOf(c), 'x크게y');
    assert.ok(c.some(ch => ch.sizeDelta > 0 && ch.text === '크게'));
});
test('짝 없는 +> 는 원문자(+>)로 복원', () => {
    assert.strictEqual(textOf(sandbox.parseStyledText('값+>끝')), '값+>끝');
});
test('짝 없는 여는 < 뒤 텍스트·기호 유실 방지 + 강조 누출 없음 (회귀)', () => {
    const c = sandbox.parseStyledText('수술 전<후 비교');
    assert.strictEqual(textOf(c), '수술 전<후 비교');
    assert.ok(!c.some(ch => ch.isHighlight));   // 짝 없는 <가 뒤를 강조하면 안 됨
});
test('짝 없는 여는 { 는 원문자({)로 복원', () => {
    const c = sandbox.parseStyledText('효과{굵게');
    assert.strictEqual(textOf(c), '효과{굵게');
    assert.ok(!c.some(ch => ch.boldLevel >= 1));
});
test('짝 없는 여는 <+ 는 원문자(<+)로 복원 + 확대 누출 없음', () => {
    const c = sandbox.parseStyledText('5<+10');
    assert.strictEqual(textOf(c), '5<+10');
    assert.ok(!c.some(ch => ch.sizeDelta > 0));
});
test('다중 stray < 모두 리터럴 보존', () => {
    assert.strictEqual(textOf(sandbox.parseStyledText('5 < 10 < 20')), '5 < 10 < 20');
});
test('여는<가 정상 중첩 토큰은 깨지 않음', () => {
    const c = sandbox.parseStyledText('A<강조>B');   // 닫힘 정상
    assert.ok(c.some(ch => ch.isHighlight && ch.text === '강조'));
});

console.log('가격 텍스트 토큰화');
test('숫자/단위 분리', () => {
    const t = sandbox.tokenizePriceText('20만원');
    assert.strictEqual(JSON.stringify(t.map(x => x.type)), JSON.stringify(['num', 'unit']));
    assert.strictEqual(JSON.stringify(t.map(x => x.text)), JSON.stringify(['20', '만원']));
});
test('콤마 포함 숫자도 num 으로', () => {
    const t = sandbox.tokenizePriceText('1,200만원');
    assert.strictEqual(t[0].type, 'num');
    assert.strictEqual(t[0].text, '1,200');
});

console.log('높이 균형 분할 (partitionByHeight)');
test('동일 높이 4개는 2:2로 균형', () => {
    const inLeft = sandbox.partitionByHeight([10, 10, 10, 10]);
    const l = inLeft.filter(Boolean).length;
    assert.strictEqual(l, 2);
});
test('합이 같아지도록 최적 분할 (3,1,1,1 → 3 | 1,1,1)', () => {
    const inLeft = sandbox.partitionByHeight([3, 1, 1, 1]);
    const sum = (sel) => [3, 1, 1, 1].reduce((a, h, i) => a + (inLeft[i] === sel ? h : 0), 0);
    assert.strictEqual(sum(true), 3);
    assert.strictEqual(sum(false), 3);
});

console.log('이름 블록 높이 (nameBlockHeight)');
test('한 줄이면 줄높이 그대로', () => {
    assert.strictEqual(sandbox.nameBlockHeight([20], 1.2), 20);
});
test('두 줄: 첫/끝 반높이 + 줄간격 배수', () => {
    // (20+20)/2 + (20+20)/2*1.2 = 20 + 24 = 44
    assert.strictEqual(sandbox.nameBlockHeight([20, 20], 1.2), 44);
});

console.log('의료법 위반 감지 (checkMedicalLaw)');
test('금지어 감지 + 대체어 제공', () => {
    const v = sandbox.checkMedicalLaw('신데렐라주사 이벤트');
    assert.ok(v.some(x => x.word === '신데렐라주사' && x.replacement === '티옥트산주사'));
});
test('예외어(엑토좀PTT)는 오탐하지 않음', () => {
    const v = sandbox.checkMedicalLaw('엑토좀PTT 관리');
    assert.ok(!v.some(x => x.word === '엑토좀' || x.word === '엑소좀'));
});
test('위반 없는 문구는 빈 배열', () => {
    assert.strictEqual(sandbox.checkMedicalLaw('보톡스 이벤트').length, 0);
});

console.log('\n' + (failed === 0
    ? `전체 통과 ✓  (${passed} passed)`
    : `실패 ${failed}건 / 통과 ${passed}건`));
process.exit(failed === 0 ? 0 : 1);
