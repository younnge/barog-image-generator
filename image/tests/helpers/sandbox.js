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
        querySelector() { return null; },
        querySelectorAll() { return []; },
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
    const toasts = [];
    const writes = [];
    const store = {};
    let quota = Infinity;

    const doc = {
        getElementById: id => els[id] || null,
        createElement: tag => (opts.canvas && tag === 'canvas'
            ? { getContext: () => ctx, width: 0, height: 0, style: {} }
            : makeElement(tag, '', { nodes: bodyNodes })),
        querySelector: () => null,
        querySelectorAll: sel => (sel === '.violation-tooltip'
            ? bodyNodes.filter(n => n.classList.contains('violation-tooltip'))
            : []),
        addEventListener() {},
        body: { appendChild(c) { bodyNodes.push(c); c._parent = { children: bodyNodes }; } },
        documentElement: { style: { setProperty() {} } },
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
        setTimeout: () => 0, clearTimeout: () => {},
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
            const el = makeElement(tag, id, { nodes: bodyNodes });
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
