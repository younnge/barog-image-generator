/* main.js 를 vm 샌드박스에 올려 테스트하기 위한 브라우저 전역 스텁.
 *
 * main.js 는 클래식 스크립트(전역 함수 선언)이므로 vm 으로 평가하면
 * 함수는 sandbox 프로퍼티로 노출된다. 다만 최상위 const/let 은 노출되지 않아
 * 읽고 쓰려면 read()/write() 로 컨텍스트 안에서 평가해야 한다.
 *
 * 필요한 만큼만 켠다:
 *   createSandbox()                       → 순수 로직용 최소 스텁
 *   createSandbox({ canvas: true })       → 캔버스 측정·그리기 (draws 배열에 기록)
 *   createSandbox({ dom: true })          → 요소 생성·이벤트 발화
 *   createSandbox({ storage: true })      → sessionStorage 쓰기 추적
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const APP = path.join(__dirname, '..', '..', 'main.js');

/* 텍스트 폭을 실제 폰트 없이 근사한다 — 한글은 전각, 나머지는 반각에 가깝게.
 * 절대값이 중요한 테스트는 없고, 측정과 그리기가 같은 값을 쓰는지가 중요하다. */
function approxTextWidth(text, size) {
    let w = 0;
    for (const ch of String(text)) w += size * (/[가-힣]/.test(ch) ? 1.0 : 0.55);
    return w;
}

function makeCtx(draws) {
    return {
        font: '20px x', letterSpacing: '0px', textAlign: 'left', textBaseline: 'top',
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt',
        shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
        imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
        measureText(t) {
            const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
            const size = m ? parseFloat(m[1]) : 20;
            return {
                width: approxTextWidth(t, size),
                actualBoundingBoxAscent: size * 0.72,
                actualBoundingBoxDescent: size * 0.05,
            };
        },
        fillText(t, x, y) { draws.push({ kind: 'text', t, x: +x.toFixed(2), y: +y.toFixed(2) }); },
        drawImage(img, ...a) { draws.push({ kind: 'img', tag: img && img.tag, a: a.map(v => +Number(v).toFixed(2)) }); },
        scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {},
        fill() {}, stroke() {}, quadraticCurveTo() {}, arc() {}, rect() {}, save() {}, restore() {},
        fillRect() {}, strokeRect() {}, clip() {}, roundRect() {}, setLineDash() {},
    };
}

/* 이벤트 발화·클래스 토글이 가능한 최소 요소. el.fire('input') 으로 리스너를 돌린다. */
function makeElement(tag = 'div', id = '', bag = null) {
    const cls = new Set();
    const el = {
        tagName: String(tag).toUpperCase(), id, value: '', textContent: '', innerHTML: '',
        style: {}, attrs: {}, dataset: {}, children: [], hidden: false, disabled: false, _listeners: {},
        classList: {
            add: c => cls.add(c), remove: c => cls.delete(c),
            contains: c => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)),
        },
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener(t, fn) { (this._listeners[t] || (this._listeners[t] = [])).push(fn); },
        removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter(f => f !== fn); },
        appendChild(c) { this.children.push(c); c._parent = this; return c; },
        remove() {
            const siblings = (this._parent && this._parent.children) || (bag && bag.nodes) || [];
            const i = siblings.indexOf(this);
            if (i >= 0) siblings.splice(i, 1);
        },
        matches(sel) { return String(sel).split(',').some(s => cls.has(s.trim().replace(/^\./, ''))); },
        closest() { return null; },
        /* innerHTML 템플릿을 파싱하지 않으므로, 스모크 테스트(autoCreate)에서는
         * 조회한 셀렉터마다 대역 노드를 만들어 돌려준다. 같은 셀렉터는 같은 노드를 준다. */
        querySelector(sel) {
            if (!(bag && bag.autoCreate)) return null;
            const cache = this._qsCache || (this._qsCache = {});
            if (!cache[sel]) {
                const stub = makeElement('div', '', bag);
                String(sel).split(',').forEach(s => stub.classList.add(s.trim().replace(/^\./, '')));
                cache[sel] = stub;
            }
            return cache[sel];
        },
        querySelectorAll() { return []; },
        focus() {}, blur() {}, click() {}, setSelectionRange() {},
        getBoundingClientRect: () => ({ top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20 }),
        fire(type, ev = {}) { (this._listeners[type] || []).forEach(fn => fn(Object.assign({ target: el }, ev))); },
    };
    // 코드가 className 에 직접 대입하므로 classList 와 동기화해 둔다
    Object.defineProperty(el, 'className', {
        get: () => [...cls].join(' '),
        set: v => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
    });
    return el;
}

function createSandbox(opts = {}) {
    const draws = [];
    const ctx = makeCtx(draws);
    const els = {};
    const bodyNodes = [];
    const bag = { nodes: bodyNodes, autoCreate: !!opts.autoCreate };
    const toasts = [];
    const writes = [];
    const store = {};
    let quota = Infinity;

    const doc = {
        // autoCreate: 초기화 배선 검증용 — main.js 는 상당수 요소를 null 가드 없이 참조하므로
        // 요청하는 id 를 즉석에서 만들어 준다(요소 존재 여부가 아니라 배선 자체를 보는 테스트).
        getElementById(id) {
            if (!els[id] && opts.autoCreate) els[id] = makeElement('div', id, bag);
            return els[id] || null;
        },
        createElement: tag => (opts.canvas && tag === 'canvas'
            ? { getContext: () => ctx, width: 0, height: 0, style: {} }
            : makeElement(tag, '', bag)),
        querySelector: () => null,
        querySelectorAll: sel => (sel === '.violation-tooltip'
            ? bodyNodes.filter(n => n.classList.contains('violation-tooltip'))
            : []),
        addEventListener() {},
        body: { appendChild(c) { bodyNodes.push(c); c._parent = { children: bodyNodes }; } },
        documentElement: { style: { setProperty() {} } },
        // main.js 는 폰트 로드 후 1회 재렌더한다 — 테스트에서는 즉시 이행되지 않게 둔다
        fonts: { ready: { then() { return this; } } },
    };

    const sessionStorage = {
        setItem(k, v) {
            const s = String(v);
            writes.push({ key: k, bytes: s.length });
            const others = Object.keys(store).reduce((a, kk) => a + (kk === k ? 0 : store[kk].length), 0);
            if (others + s.length > quota) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            store[k] = s;
        },
        getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        removeItem(k) { delete store[k]; },
    };

    const sandbox = {
        window: { addEventListener() {} },
        document: doc,
        console, Math, JSON, String, Array, RegExp, Object, Number, Date,
        parseInt, parseFloat, isNaN, Set, Map, Uint8Array,
        Image: function () {},
        MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
        requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
        setTimeout: () => 0, clearTimeout: () => {},
        setInterval: () => 0, clearInterval: () => {},
        getComputedStyle: () => ({ maxHeight: 'none', lineHeight: '20px' }),
        sessionStorage,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(APP, 'utf8'), sandbox);

    // 토스트는 화면 대신 배열로 — 테스트가 안내 문구를 검증할 수 있게
    sandbox.__collectToast = m => toasts.push(m);
    vm.runInContext('showColorToast = function (m) { __collectToast(m); }', sandbox);

    return {
        sandbox, ctx, draws, els, toasts, writes, bodyNodes,
        /* 최상위 const/let 읽기 — 샌드박스 프로퍼티로는 보이지 않는다 */
        read: expr => vm.runInContext(expr, sandbox),
        /* 최상위 let 쓰기 */
        write(name, value) { sandbox.__w = value; vm.runInContext(name + ' = __w', sandbox); },
        addElement(id, tag = 'div', classes = []) {
            const el = makeElement(tag, id, bag);
            classes.forEach(c => el.classList.add(c));
            els[id] = el;
            return el;
        },
        setQuota(bytes) { quota = bytes; },
        resetWrites() { writes.length = 0; toasts.length = 0; },
        makeImage: (w, h, tag) => ({ width: w, height: h, tag }),
        makeDataImage: (mb, tag) => ({ src: 'data:image/jpeg;base64,' + tag + 'x'.repeat(Math.round(mb * 1048576)) }),
    };
}

module.exports = { createSandbox, makeElement, approxTextWidth };
