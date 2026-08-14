/* 최소 테스트 러너 — 외부 의존성 없이 Node 내장만 사용.
 * 각 테스트 파일은 이 모듈을 공유하므로 카운터가 한 프로세스 안에서 누적된다.
 * 파일을 직접 실행해도, tests/run.js 로 한 번에 돌려도 같은 형식으로 보고한다.
 *
 * 비동기 테스트: fn 이 프로미스를 돌려주면 flush() 가 끝날 때까지 기다린다.
 * 기다리지 않으면 await 뒤의 assert 실패가 집계에 잡히지 않고 새어나간다.
 * 그 대신 비동기 테스트의 ✓/✗ 줄은 같은 파일의 동기 테스트보다 뒤에 찍힌다(순서만 밀림). */
let passed = 0, failed = 0;
const failures = [];
const pending = [];

function group(name) {
    console.log(name);
}

function pass(name) {
    passed++;
    console.log('  ✓ ' + name);
}

function fail(name, e) {
    failed++;
    failures.push(name);
    console.log('  ✗ ' + name + '\n      ' + e.message);
}

function test(name, fn) {
    let out;
    try {
        out = fn();
    } catch (e) {
        return fail(name, e);
    }
    if (out && typeof out.then === 'function') {
        pending.push(out.then(() => pass(name), e => fail(name, e)));
        return;
    }
    pass(name);
}

/* 등록된 비동기 테스트가 모두 끝날 때까지 기다린다. 보고 직전에 반드시 부른다. */
function flush() {
    const waiting = pending.splice(0);
    return Promise.all(waiting);
}

/* 실패 건수를 그대로 종료 코드로 쓸 수 있게 반환한다(0 = 전체 통과). */
function report(label = '') {
    console.log('\n' + (failed === 0
        ? `전체 통과 ✓  (${passed} passed)${label ? ' — ' + label : ''}`
        : `실패 ${failed}건 / 통과 ${passed}건\n  실패 목록: ${failures.join(', ')}`));
    return failed === 0 ? 0 : 1;
}

/* 파일 하나만 직접 실행할 때의 마무리 — 비동기 테스트까지 기다린 뒤 종료 코드를 낸다. */
function finish(label) {
    flush().then(() => process.exit(report(label)));
}

module.exports = { group, test, report, flush, finish };
