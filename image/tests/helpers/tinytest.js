/* 최소 테스트 러너 — 외부 의존성 없이 Node 내장만 사용.
 * 각 테스트 파일은 이 모듈을 공유하므로 카운터가 한 프로세스 안에서 누적된다.
 * 파일을 직접 실행해도, tests/run.js 로 한 번에 돌려도 같은 형식으로 보고한다. */
let passed = 0, failed = 0;
const failures = [];

function group(name) {
    console.log(name);
}

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  ✓ ' + name);
    } catch (e) {
        failed++;
        failures.push(name);
        console.log('  ✗ ' + name + '\n      ' + e.message);
    }
}

/* 실패 건수를 그대로 종료 코드로 쓸 수 있게 반환한다(0 = 전체 통과). */
function report(label = '') {
    console.log('\n' + (failed === 0
        ? `전체 통과 ✓  (${passed} passed)${label ? ' — ' + label : ''}`
        : `실패 ${failed}건 / 통과 ${passed}건\n  실패 목록: ${failures.join(', ')}`));
    return failed === 0 ? 0 : 1;
}

module.exports = { group, test, report };
