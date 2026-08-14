/* 언어 자동 판별 — 선택창을 없앤 뒤 문구만으로 폰트 체인을 정하므로,
 * 오판이 곧 인쇄물의 글자 모양이 달라지는 결과로 이어진다. */
const assert = require('assert');
const { group, test, report } = require('./helpers/tinytest');
const { createSandbox } = require('./helpers/sandbox');

const env = createSandbox();
const { sandbox } = env;
const detect = env.read('detectDocLang');
const SIMP = env.read('HANZI_SIMP');
const TRAD = env.read('HANZI_TRAD');

group('간체 / 번체 글자표 건전성');

test('두 표의 길이가 같다 (쌍이 어긋나지 않음)', () => {
    assert.strictEqual(SIMP.length, TRAD.length);
});

test('표 안에 중복 글자가 없다', () => {
    const dupS = [...SIMP].filter((c, i, a) => a.indexOf(c) !== i);
    const dupT = [...TRAD].filter((c, i, a) => a.indexOf(c) !== i);
    assert.strictEqual(dupS.length, 0, '간체표 중복: ' + dupS.join(''));
    assert.strictEqual(dupT.length, 0, '번체표 중복: ' + dupT.join(''));
});

test('양쪽 표에 동시에 들어간 글자가 없다', () => {
    const both = [...new Set([...SIMP].filter(c => TRAD.includes(c)))];
    assert.strictEqual(both.length, 0, '양쪽 공통: ' + both.join(''));
});

test('두 서체에서 모두 정상인 글자는 표에 없다 (오판 방지)', () => {
    // 干·后·只·台 등은 번체 문서에도 그대로 나오므로 판별 근거가 될 수 없다
    const RISKY = '干后只云里面谷台余系制种向才卜板表丑冲斗出家借卷克困累了蒙沈松咸郁御朱曲千秋辟仆朴划回伙致准帘舍岳布范美硬';
    const leaked = [...RISKY].filter(c => SIMP.includes(c) || TRAD.includes(c));
    assert.strictEqual(leaked.length, 0, '유입된 공용 글자: ' + leaked.join(''));
});

group('판별 결과');

const cases = [
    ['한국어 전단', '바로그 강남점 5월 이벤트\n보톡스 이마·미간 1회 4만원', 'ko'],
    ['한글 + 한자 섞임', '바로그 5월 이벤트\n肉毒桿菌 額頭 1次 4萬韓元', 'ko'],
    ['영문·숫자만', 'BAROG EVENT 2026.05.01 - 05.31', 'ko'],
    ['빈 문서', '', 'ko'],
    ['일본어(가나 포함)', 'バログ江南店 5月イベント 1回 4万ウォン', 'ja'],
    ['일본어(한자 많음)', '医療脱毛 額 1回 4万円 ヒアルロン酸', 'ja'],
    ['태국어', 'บาร็อก สาขาคังนัม โบท็อกซ์ 40,000 วอน', 'th'],
    ['중국어 간체 전단', '巴洛格江南店 五月优惠 肉毒杆菌 额头 1次 4万韩元 医疗价格优惠', 'zhCN'],
    ['대만 번체 전단', '巴洛格江南店 五月優惠 肉毒桿菌 額頭 1次 4萬韓元 醫療價格優惠', 'zhTW'],
    ['간체 — 가격만', '4万韩元 9万韩元', 'zhCN'],
    ['번체 — 가격만', '4萬韓元 9萬韓元', 'zhTW'],
    ['간체 — 시술명만', '医疗 皮肤 手术 双眼皮 减肥', 'zhCN'],
    ['번체 — 시술명만', '醫療 皮膚 手術 雙眼皮 減肥', 'zhTW'],
    ['판별 글자 없는 한자 → 간체로 폴백', '美容 注射 玻尿酸 1cc 15', 'zhCN'],
];
cases.forEach(([name, text, want]) => {
    test(name, () => assert.strictEqual(detect(text), want));
});

group('폰트 체인');

test('어떤 언어에서도 네 가지 Noto 가 모두 체인에 남는다', () => {
    // 판별이 틀려도 글자가 깨지지 않아야 한다 — 획 모양만 달라질 뿐
    for (const lang of ['ko', 'ja', 'zhCN', 'zhTW', 'th']) {
        sandbox.applyDocLang(lang);
        const main = env.read('CONFIG.fonts.main');
        const notos = main.match(/Noto Sans (JP|SC|TC|Thai)/g) || [];
        assert.strictEqual(notos.length, 4, `${lang}: ${notos.length}/4`);
    }
});

test('선택한 언어의 폰트가 체인 맨 앞에 온다', () => {
    const expect = { ko: 'JP', ja: 'JP', zhCN: 'SC', zhTW: 'TC', th: 'Thai' };
    for (const [lang, first] of Object.entries(expect)) {
        sandbox.applyDocLang(lang);
        const notos = env.read('CONFIG.fonts.main').match(/Noto Sans (JP|SC|TC|Thai)/g);
        assert.strictEqual(notos[0], 'Noto Sans ' + first, lang);
    }
});

test('알 수 없는 언어 코드는 한국어로 폴백', () => {
    sandbox.applyDocLang('xx');
    assert.strictEqual(env.read('docLang'), 'ko');
});

if (require.main === module) process.exit(report('lang'));
