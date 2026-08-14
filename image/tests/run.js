/* 전체 테스트 실행 — npm test 진입점.
 * 각 파일은 공용 tinytest 카운터를 공유하므로 여기서 한 번만 집계한다.
 * 개별 파일도 그대로 실행할 수 있다: node tests/lang.test.js
 *
 * 파일마다 flush() 로 비동기 테스트를 기다린 뒤 다음 파일로 넘어간다.
 * 그래야 결과가 파일 순서대로 찍히고, await 뒤의 실패도 집계에 잡힌다. */
const { report, flush } = require('./helpers/tinytest');

const FILES = [
    './logic.test.js',       // 순수 로직 — DSL 파서·가격 토큰·높이 분할·금지어
    './lang.test.js',        // 문서 언어 자동 판별 + 폰트 체인
    './render.test.js',      // 측정/그리기 일치 · 가격 그리드 · 로고 기하
    './persist.test.js',     // 백업·세션 복원 · 세션 기록 억제
    './violation.test.js',   // 의료법 검사 배선(제목·기간 포함) · 툴팁 수명
    './font.test.js',        // 캔버스 웹폰트 도착 확인 · 실패 안내
    './gate.test.js',        // 진입 암호 — 통과·차단·기억
    './init.test.js',        // window.onload 배선 스모크 — 초기화가 끝까지 도는지
];

(async () => {
    for (const f of FILES) {
        console.log('\n────────────────────────────────────────');
        console.log('  ' + f.replace('./', '').replace('.test.js', ''));
        console.log('────────────────────────────────────────');
        require(f);
        await flush();
    }
    process.exit(report(`${FILES.length}개 파일`));
})();
