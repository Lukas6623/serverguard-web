// These are isolated frontend state tests with a small DOM/fetch stub.
// They do not test layout, browser APIs, SSH, or a real ServerGuard backend.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const moduleIds = ["sshkeys", "security", "telegram", "hardening", "fileguard"];
const metrics = ["statCpu", "statMemory", "statDisk", "statUptime", "statNetwork"];
const info = ["infoHostname", "infoOs", "infoKernel", "infoCpu", "infoLoad", "infoProcesses"];
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ core = false, registerModules = true } = {}) {
    const nodes = new Map();
    const calls = [];
    const backendStates = [];
    const timers = new Set();
    let handler = () => response({});
    const document = { hidden: false, activeElement: null };
    class Element {
        constructor() {
            this.dataset = {};
            this.attributes = {};
            this.listeners = {};
            this.children = [];
            this.textContent = "";
            this.hidden = false;
            this.disabled = false;
            this.className = "";
            this.classList = {
                toggle: (key, enabled) => { this.attributes["class:" + key] = enabled; }
            };
        }
        setAttribute(key, value) { this.attributes[key] = value; }
        getAttribute(key) { return this.attributes[key]; }
        addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
        append(...elements) { this.children.push(...elements); }
        replaceChildren(...elements) { this.children = [...elements]; }
        querySelectorAll(selector) { return selector === "button" ? this.children : []; }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        focus() { document.activeElement = this; }
        showModal() { this.open = true; }
        close() { this.open = false; }
    }
    const listeners = {};
    Object.assign(document, {
        getElementById: id => nodes.get(id) || null,
        createElement: () => new Element(),
        addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); },
        dispatchEvent: event => (listeners[event.type] || []).forEach(fn => fn(event)),
        querySelector: selector => sections.find(section => selector.includes('"' + section.dataset.module + '"')) || null,
        querySelectorAll: selector => selector === "[data-module]" ? sections : []
    });
    for (const [, id] of fs.readFileSync("web/index.html", "utf8").matchAll(/\bid="([^"]+)"/g)) {
        nodes.set(id, new Element());
    }
    document.body = new Element();
    const sections = ["overview", ...moduleIds].map(id => {
        const section = new Element();
        section.dataset.module = id;
        return section;
    });
    const context = {
        document, console, Event, AbortController, SyntaxError, Date,
        setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.add(timer); return timer; },
        clearTimeout: timer => timers.delete(timer),
        setInterval: () => {},
        fetch: (path, options) => { calls.push({ path, options }); return handler(path, options); },
        window: {}
    };
    if (core) {
        vm.runInNewContext(fs.readFileSync("web/core/core.js", "utf8"), context);
        if (registerModules) moduleIds.forEach(id => context.window.ServerGuard.registerModule(id, {}));
    } else {
        context.window.ServerGuard = {
            $: document.getElementById,
            syncBackend: (available, force) => { backendStates.push([available, force]); return Promise.resolve(true); }
        };
        vm.runInNewContext(fs.readFileSync("web/core/dashboard.js", "utf8"), context);
    }
    return {
        context, nodes, calls, backendStates, sections, timers,
        get: id => nodes.get(id),
        route: fn => { handler = fn; },
        start: async () => { document.dispatchEvent({ type: "serverguard:ready" }); await flush(); },
        refresh: async () => { await nodes.get("refreshDashboard").listeners.click[0](); await flush(); },
        nav: () => nodes.get("nav").children,
        core: context.window.ServerGuard
    };
}

function response(data, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function healthy(h, data) {
    h.route(path => response(path === "/api/health" ? { ok: true } : data));
}

function assertOffline(h) {
    assert.equal(h.get("serverStatus").textContent, "OFFLINE");
    assert.equal(h.context.document.body.dataset.connection, "offline");
    [...metrics, ...info].forEach(id => assert.equal(h.get(id).textContent, "—", id));
    assert.equal(h.get("connectionNotice").hidden, false);
}

test("initial state is OFFLINE without invented metric values", () => {
    assertOffline(harness());
});

test("static server /health 404 stays OFFLINE and never requests stats", async () => {
    const h = harness();
    h.route(() => response({}, 404));
    await h.start();
    assertOffline(h);
    assert.deepEqual(h.calls.map(call => call.path), ["/api/health"]);
    assert.match(h.get("connectionMessage").textContent, /HTTP 404/);
    assert.deepEqual(h.backendStates, [[false, undefined]]);
});

test("health error JSON cannot produce ONLINE", async () => {
    const h = harness();
    h.route(() => response({ error: "not connected" }));
    await h.start();
    assertOffline(h);
    assert.equal(h.calls.length, 1);
});

test("health HTTP 500 cannot produce ONLINE even with otherwise valid JSON", async () => {
    const h = harness();
    h.route(() => response({ ok: true }, 500));
    await h.start();
    assertOffline(h);
    assert.equal(h.calls.length, 1);
});

test("unauthorized stats revoke module availability and clear the server", async () => {
    const h = harness();
    h.route(path => response({}, path === "/api/health" ? 200 : 401));
    await h.start();
    assertOffline(h);
    assert.match(h.get("connectionMessage").textContent, /Нет доступа/);
    assert.equal(h.backendStates.at(-1)[0], false);
});

test("malformed stats JSON produces a visible error and restores the refresh control", async () => {
    const h = harness();
    h.route(path => path === "/api/health" ? response({}) : {
        ok: true, status: 200, json: async () => { throw new SyntaxError("invalid JSON"); }
    });
    await h.start();
    assertOffline(h);
    assert.match(h.get("connectionMessage").textContent, /неожиданном формате/);
    assert.equal(h.get("refreshDashboard").disabled, false);
});

test("health success with empty or error stats does not claim ONLINE", async () => {
    for (const data of [{}, { error: "SSH closed" }, { ok: false }, [], { cpu_percent: null }]) {
        const h = harness();
        healthy(h, data);
        await h.start();
        assertOffline(h);
    }
});

test("health does not acquire an invented object-only response schema", async () => {
    for (const health of [true, "ok"]) {
        const h = harness();
        h.route(path => response(path === "/api/health" ? health : { hostname: "remote", cpu_percent: 2 }));
        await h.start();
        assert.equal(h.get("serverStatus").textContent, "ONLINE");
    }
});

test("valid existing API fields render as text; missing network stays missing", async () => {
    const h = harness();
    const hostname = '<img src=x onerror="bad()">';
    healthy(h, { hostname, cpu_percent: 23.5, memory_percent: 42, disk_percent: 61, uptime: 90061 });
    await h.start();
    assert.equal(h.get("serverStatus").textContent, "ONLINE");
    assert.equal(h.get("serverTitle").textContent, hostname);
    assert.equal(h.get("serverTitle").innerHTML, undefined);
    assert.equal(h.get("statCpu").textContent, "23.5%");
    assert.equal(h.get("statUptime").textContent, "1 д 1 ч");
    assert.equal(h.get("statNetwork").textContent, "—");
    assert.equal(h.get("infoOs").textContent, "—");
    assert.equal(h.get("connectionNotice").hidden, true);
    for (const call of h.calls) {
        assert.equal(call.options.method, "GET");
        assert.equal(call.options.credentials, "same-origin");
    }
});

test("real zero is preserved; one missing network direction is not turned into zero", async () => {
    const h = harness();
    healthy(h, { cpu: 0, mem_percent: 0, disk: 0, uptime: 0, network_rx_speed: 0 });
    await h.start();
    assert.equal(h.get("statCpu").textContent, "0.0%");
    assert.equal(h.get("statMemory").textContent, "0.0%");
    assert.equal(h.get("statDisk").textContent, "0.0%");
    assert.equal(h.get("statUptime").textContent, "0 мин");
    assert.equal(h.get("statNetwork").textContent, "↓ 0 B/s / ↑ —");
});

test("network null, blank and negative values do not become zero", async () => {
    for (const value of [null, "", " ", -1, false]) {
        const h = harness();
        healthy(h, { hostname: "remote", network_rx_speed: value, network_tx_speed: value });
        await h.start();
        assert.equal(h.get("statNetwork").textContent, "—");
    }
});

test("legacy fields and total-network fallback remain supported", async () => {
    const h = harness();
    healthy(h, { host: "remote", cpu: "15%", mem_percent: 12, disk: "9%", network_total: 2048,
        operating_system: "Debian", kernel_version: "6.1", processor: "remote CPU", load_average: 0.25, process_count: 60 });
    await h.start();
    assert.equal(h.get("statNetwork").textContent, "2.0 KB");
    assert.equal(h.get("infoOs").textContent, "Debian");
    assert.equal(h.get("infoProcesses").textContent, "60");
    assert.equal(h.get("infoLoad").textContent, "0.25");
});

test("stats failure clears all old measurements and server details, then recovers", async () => {
    const h = harness();
    healthy(h, { hostname: "remote", cpu_percent: 12, memory_percent: 45, disk_percent: 50, uptime: 100,
        network_rx_speed: 2048, os: "Debian", kernel: "6.1", cpu_model: "remote CPU", load1: 1, processes: 20 });
    await h.start();
    h.route(path => response(path === "/api/health" ? { ok: true } : {}, path === "/api/health" ? 200 : 503));
    await h.refresh();
    assertOffline(h);
    assert.match(h.get("connectionMessage").textContent, /HTTP 503/);
    assert.doesNotMatch(h.get("serverTitle").textContent, /remote/);
    healthy(h, { hostname: "remote-restored", cpu_percent: 8 });
    await h.refresh();
    assert.equal(h.get("serverStatus").textContent, "ONLINE");
    assert.equal(h.get("infoHostname").textContent, "remote-restored");
});

test("manual refresh is guarded against overlapping requests and restores controls", async () => {
    const h = harness();
    let finish;
    h.route(path => path === "/api/health" ? response({ ok: true }) : new Promise(resolve => { finish = resolve; }));
    await h.start();
    assert.equal(h.get("refreshDashboard").disabled, true);
    await h.refresh();
    assert.equal(h.calls.length, 2);
    finish(response({ hostname: "remote", cpu_percent: 1 }));
    await flush();
    assert.equal(h.get("refreshDashboard").disabled, false);
    assert.equal(h.get("serverMetrics").getAttribute("aria-busy"), "false");
    assert.equal(h.get("serverStatus").textContent, "ONLINE");
});

test("core restores only backend-enabled modules after disconnect and reconnect", async () => {
    const h = harness({ core: true });
    let initialLoads = 0;
    h.core.registerModule("sshkeys", { initialLoad: () => initialLoads++ });
    await h.core.syncBackend(false);
    assert.equal(h.nav().filter(button => !button.disabled).length, 1);
    h.route(path => {
        assert.equal(path, "/api/modules");
        return response({ sshkeys: true, security: false });
    });
    await h.core.syncBackend(true);
    await flush();
    assert.equal(h.nav().find(button => button.dataset.nav === "sshkeys").disabled, false);
    assert.equal(h.nav().find(button => button.dataset.nav === "security").disabled, true);
    const button = h.nav().find(button => button.dataset.nav === "sshkeys");
    button.focus();
    button.onclick();
    assert.equal(h.context.document.activeElement.dataset.nav, "sshkeys");
    await h.core.syncBackend(false);
    assert.equal(h.context.document.activeElement.dataset.nav, "overview");
    await h.core.syncBackend(true);
    await flush();
    assert.equal(h.nav().find(button => button.dataset.nav === "sshkeys").disabled, false);
    assert.equal(initialLoads, 2);
    assert(h.calls.every(call => call.path === "/api/modules"));
});

test("core ignores a stale module response arriving after disconnection", async () => {
    const h = harness({ core: true });
    let finish;
    h.route(() => new Promise(resolve => { finish = resolve; }));
    const oldRequest = h.core.syncBackend(true);
    await h.core.syncBackend(false);
    finish(response({ sshkeys: true }));
    await oldRequest;
    assert.equal(h.nav().filter(button => !button.disabled).length, 1);
});

test("a failed module list is retried and cannot enable missing module scripts", async () => {
    const h = harness({ core: true });
    h.route(() => response({}, 503));
    await h.core.syncBackend(true);
    assert.equal(h.nav().filter(button => !button.disabled).length, 1);
    h.route(() => response({ fileguard: true }));
    await h.core.syncBackend(true);
    assert.equal(h.nav().find(button => button.dataset.nav === "fileguard").disabled, false);
    const emptyCore = harness({ core: true, registerModules: false });
    emptyCore.route(() => response({ fileguard: true }));
    await emptyCore.core.syncBackend(true);
    assert.equal(emptyCore.nav().filter(button => !button.disabled).length, 1);
});

test("the existing Escape confirmation handler resolves cancellation", async () => {
    const h = harness({ core: true });
    const confirmation = h.core.ask("Подтвердить", "Проверка");
    h.get("dlg").oncancel();
    assert.equal(await confirmation, false);
    assert.equal(h.get("dlg").open, false);
});
