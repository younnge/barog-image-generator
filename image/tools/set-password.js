#!/usr/bin/env node
/* 진입 암호를 바꾸는 도구.
 *
 *   node tools/set-password.js "새암호"
 *
 * 출력된 한 줄을 gate.js 의 GATE_HASH 에 붙여넣고 커밋하면 됩니다.
 * 암호 자체는 어디에도 저장되지 않습니다.
 *
 * 주의 — 이 방식은 '우연한 접근'을 막는 커튼입니다.
 * 저장소가 공개라 해시가 그대로 보이고, 짧거나 흔한 암호는 대입으로 풀립니다.
 * 실제 접근 제어가 필요하면 Cloudflare Access 같은 인증 게이트를 앞에 두세요.
 */
const crypto = require('crypto');

const SALT = 'barog-image-generator';   // 레인보우 테이블 무력화용 — 비밀이 아닙니다
const pw = process.argv[2];

if (!pw) {
    console.error('사용법: node tools/set-password.js "새암호"');
    process.exit(1);
}
if (pw.length < 8) {
    console.error(`암호가 ${pw.length}자입니다. 최소 8자 이상으로 정해 주세요.`);
    console.error('해시가 공개되므로 짧은 암호는 금방 풀립니다.');
    process.exit(1);
}

const hash = crypto.createHash('sha256').update(SALT + ':' + pw, 'utf8').digest('hex');

console.log('\ngate.js 의 GATE_HASH 를 아래 값으로 바꾸세요:\n');
console.log(`const GATE_HASH = '${hash}';\n`);
console.log('바꾼 뒤 커밋·푸시하면 적용됩니다.');
console.log('기존에 로그인해 둔 직원은 암호를 다시 입력해야 합니다(의도된 동작).\n');
