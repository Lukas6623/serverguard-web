/* ============================================================
   MODULE: FILEGUARD — логика

   API (WebServer::handleFileGuard):
     GET  /api/fileguard/status | events | baseline | state | logs
     POST /api/fileguard/start | stop | restart | enable | disable
          /api/fileguard/clear-events | rebuild-baseline

   Публичный интерфейс для загрузчика модулей:
     window.FileGuardModule.init(rootElement?)   — запуск
     window.FileGuardModule.destroy()            — остановка опроса
   Если #fg-root уже есть в DOM при загрузке скрипта — init() вызовется сам.
   Регистрируется в core через ServerGuard.registerModule("fileguard", ...).
   ============================================================ */

(function () {
  "use strict";

  var API = "/api/fileguard";
  var POLL_MS = 5000;
  var MAX_ROWS = 300;
  var SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM"];
  var SEV_LABEL = { CRITICAL: "Критичные", HIGH: "Высокие", MEDIUM: "Средние" };
  var TYPE_LABEL = {
    created: "Создан",
    modified: "Изменён",
    deleted: "Удалён",
    permissions_changed: "Права изменены"
  };
  var ACTION_LABEL = {
    start: "Запуск",
    stop: "Остановка",
    restart: "Перезапуск",
    enable: "Автозапуск включён",
    disable: "Автозапуск выключен",
    "rebuild-baseline": "Базовый снимок",
    "clear-events": "Журнал событий"
  };
  var CONFIRM = {
    stop: "Остановить FileGuard? Изменения файлов не будут отслеживаться, пока он выключен.",
    "rebuild-baseline": "Пересоздать базовый снимок? Текущее состояние файлов будет принято как эталон. Делайте это, только если уверены, что все изменения легитимны.",
    "clear-events": "Очистить весь журнал событий? Это действие нельзя отменить."
  };

  var root = null;
  var timer = null;
  var toastTimer = null;
  var onRootClick = null;

  var S = {
    tab: "events",
    status: null,
    events: [],
    baseline: {},
    state: {},
    sev: {},          // выбранные уровни важности; пусто = все
    busy: false,
    loading: false
  };

  /* ---------- helpers ---------- */

  function q(name) { return root.querySelector('[data-fg="' + name + '"]'); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function toast(msg, isErr) {
    var t = q("toast");
    t.textContent = msg;
    t.className = "fg-toast" + (isErr ? " fg-err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add("fg-hidden"); }, 4500);
  }

  function showError(msg) {
    var b = q("error");
    if (!msg) { b.classList.add("fg-hidden"); return; }
    b.textContent = msg;
    b.classList.remove("fg-hidden");
  }

  function api(path, method) {
    return fetch(API + path, {
      method: method || "GET",
      credentials: "same-origin",
      cache: "no-store"
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.status === 401) {
          throw new Error("Нет доступа. Откройте панель по ссылке с токеном, которую ServerGuard печатает при запуске.");
        }
        if (!res.ok) {
          throw new Error((data && (data.error || data.output)) || ("Ошибка " + res.status));
        }
        return data;
      });
    });
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso || "";
    return d.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  }

  function shortHash(h) { return h ? h.slice(0, 12) + "…" : "—"; }

  function isObject(v) { return v && typeof v === "object" && !Array.isArray(v); }

  function selectedCount() { return Object.keys(S.sev).length; }

  /* ---------- status ---------- */

  function renderStatus() {
    var s = S.status;
    if (!s) return;

    q("service").textContent = s.service || "";

    var text = "Не установлена", cls = "fg-dot bad";
    if (s.installed) {
      if (s.active) { text = "Работает"; cls = "fg-dot on"; }
      else if (s.state === "failed") { text = "Ошибка"; cls = "fg-dot bad"; }
      else { text = "Остановлена"; cls = "fg-dot off"; }
    }
    q("dot").className = cls;
    q("state").textContent = text;
    q("enabled").textContent = s.enabled ? "Включён" : "Выключен";
    q("baseline").textContent = s.baseline ? "Создан" : "Нет";

    var off = S.busy || !s.installed;
    setDisabled("start", off || s.active);
    setDisabled("stop", off || !s.active);
    setDisabled("restart", off);
    setDisabled("enable", off || s.enabled);
    setDisabled("disable", off || !s.enabled);
    setDisabled("rebuild-baseline", off);
    setDisabled("clear-events", S.busy);
  }

  function setDisabled(action, value) {
    var b = root.querySelector('[data-fg-act="' + action + '"]');
    if (b) b.disabled = !!value;
  }

  function loadStatus() {
    return api("/status").then(function (data) {
      S.status = data;
      renderStatus();
    });
  }

  /* ---------- events ---------- */

  function renderChips() {
    var wrap = q("chips");
    clear(wrap);

    var counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0 };
    S.events.forEach(function (e) {
      if (counts[e.severity] !== undefined) counts[e.severity]++;
    });

    SEVERITIES.forEach(function (sev) {
      var b = el("button", "fg-chip");
      b.type = "button";
      b.setAttribute("aria-pressed", S.sev[sev] ? "true" : "false");
      b.appendChild(document.createTextNode(SEV_LABEL[sev]));
      b.appendChild(el("b", null, String(counts[sev])));
      b.addEventListener("click", function () {
        if (S.sev[sev]) delete S.sev[sev]; else S.sev[sev] = true;
        renderEvents();
      });
      wrap.appendChild(b);
    });
  }

  function diffTable(oldS, newS) {
    oldS = oldS || {};
    newS = newS || {};

    var fields = [
      ["exists", "Существует"],
      ["type", "Тип"],
      ["mode", "Права"],
      ["uid", "UID"],
      ["gid", "GID"],
      ["size", "Размер, байт"],
      ["sha256", "SHA-256"]
    ];

    var rows = fields.filter(function (f) {
      return JSON.stringify(oldS[f[0]]) !== JSON.stringify(newS[f[0]]);
    });

    if (!rows.length) {
      return el("div", "fg-nodiff", "Метаданные и содержимое не изменились.");
    }

    var t = el("table", "fg-diff");
    var head = el("tr");
    ["Поле", "Было", "Стало"].forEach(function (h) { head.appendChild(el("th", null, h)); });
    t.appendChild(head);

    function val(v) { return v === undefined || v === null ? "—" : String(v); }

    rows.forEach(function (f) {
      var tr = el("tr");
      tr.appendChild(el("th", null, f[1]));
      tr.appendChild(el("td", "fg-was", val(oldS[f[0]])));
      tr.appendChild(el("td", "fg-now", val(newS[f[0]])));
      t.appendChild(tr);
    });
    return t;
  }

  function renderEvents() {
    renderChips();

    var query = q("eventSearch").value.trim().toLowerCase();
    var type = q("typeFilter").value;
    var filtering = selectedCount() > 0;

    var list = S.events.slice().reverse().filter(function (e) {
      return (!filtering || S.sev[e.severity]) &&
             (!type || e.type === type) &&
             (!query || String(e.path || "").toLowerCase().indexOf(query) !== -1);
    });

    q("total").textContent = String(S.events.length);

    var box = q("events");
    clear(box);

    if (!list.length) {
      box.appendChild(el("div", "fg-empty",
        S.events.length
          ? "Нет событий под выбранные фильтры."
          : "Изменений не было. Записи появятся, когда FileGuard заметит правку контролируемых файлов."));
      return;
    }

    list.slice(0, MAX_ROWS).forEach(function (e) {
      var d = el("details", "fg-row");
      var s = el("summary");
      s.appendChild(el("span", "fg-time", fmtTime(e.timestamp)));
      s.appendChild(el("span", "fg-sev " + e.severity, e.severity));
      s.appendChild(el("span", "fg-type", TYPE_LABEL[e.type] || e.type));
      s.appendChild(el("span", "fg-path", e.path));
      d.appendChild(s);

      var body = el("div", "fg-detail");
      body.appendChild(diffTable(e.old_state, e.new_state));
      d.appendChild(body);
      box.appendChild(d);
    });

    if (list.length > MAX_ROWS) {
      box.appendChild(el("div", "fg-empty",
        "Показаны последние " + MAX_ROWS + " из " + list.length + ". Уточните фильтр."));
    }
  }

  function loadEvents() {
    return api("/events").then(function (data) {
      S.events = Array.isArray(data) ? data : [];
      // не перерисовываем список, пока пользователь читает раскрытую запись
      if (!root.querySelector(".fg-row[open]")) renderEvents();
      else { renderChips(); q("total").textContent = String(S.events.length); }
    });
  }

  /* ---------- baseline ---------- */

  function renderBaseline() {
    var query = q("baseSearch").value.trim().toLowerCase();
    var onlyDrift = q("onlyDrift").checked;

    var all = {};
    Object.keys(S.baseline).forEach(function (p) { all[p] = true; });
    Object.keys(S.state).forEach(function (p) {
      var c = S.state[p];
      if (c && c.exists) all[p] = true;
    });

    var rows = Object.keys(all).sort().map(function (p) {
      var b = S.baseline[p];
      var c = S.state[p];
      var drift = "";
      if (!b && c) drift = "новый файл";
      else if (b && (!c || c.exists === false)) drift = "удалён";
      else if (b && c && JSON.stringify(b) !== JSON.stringify(c)) drift = "изменён";
      return { path: p, base: b, cur: c, drift: drift };
    }).filter(function (r) {
      return (!query || r.path.toLowerCase().indexOf(query) !== -1) &&
             (!onlyDrift || r.drift);
    });

    q("baseCount").textContent = rows.length + " из " + Object.keys(all).length;

    var box = q("baseline-table");
    clear(box);

    if (!rows.length) {
      box.appendChild(el("div", "fg-empty",
        Object.keys(S.baseline).length
          ? "Ничего не найдено."
          : "Базовый снимок пуст. Запустите FileGuard, чтобы он его создал."));
      return;
    }

    var wrap = el("div", "fg-scroll");
    var t = el("table", "fg-base");
    var head = el("tr");
    ["Путь", "Тип", "Права", "Владелец", "Размер", "SHA-256", "Статус"].forEach(function (h) {
      head.appendChild(el("th", null, h));
    });
    t.appendChild(head);

    rows.forEach(function (r) {
      var s = r.cur && r.cur.exists !== false ? r.cur : (r.base || {});
      var tr = el("tr");
      tr.appendChild(el("td", "fg-mono", r.path));
      tr.appendChild(el("td", null, s.type || "—"));
      tr.appendChild(el("td", "fg-mono", s.mode || "—"));
      tr.appendChild(el("td", "fg-mono", s.uid !== undefined ? s.uid + ":" + s.gid : "—"));
      tr.appendChild(el("td", null, s.size !== undefined ? String(s.size) : "—"));
      var h = el("td", "fg-mono", shortHash(s.sha256));
      if (s.sha256) h.title = s.sha256;
      tr.appendChild(h);
      tr.appendChild(el("td", r.drift ? "fg-drift" : "", r.drift || "совпадает"));
      t.appendChild(tr);
    });

    wrap.appendChild(t);
    box.appendChild(wrap);
  }

  function loadBaseline() {
    return Promise.all([api("/baseline"), api("/state")]).then(function (res) {
      S.baseline = isObject(res[0]) ? res[0] : {};
      S.state = isObject(res[1]) ? res[1] : {};
      renderBaseline();
    });
  }

  /* ---------- logs ---------- */

  function loadLogs() {
    return api("/logs").then(function (data) {
      var pre = q("logs");
      var stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
      pre.textContent = (data && data.logs) || "Лог пуст.";
      if (stick) pre.scrollTop = pre.scrollHeight;
    });
  }

  /* ---------- refresh / tabs / actions ---------- */

  function refresh() {
    if (!root || !root.isConnected || S.loading) return Promise.resolve();
    S.loading = true;

    return loadStatus()
      .then(function () {
        showError("");
        if (S.tab === "events") return loadEvents();
        if (S.tab === "baseline") return loadBaseline();
        if (S.tab === "logs") return loadLogs();
      })
      .catch(function (e) { showError(e.message); })
      .then(function () { S.loading = false; });
  }

  function setTab(name) {
    S.tab = name;
    Array.prototype.forEach.call(root.querySelectorAll("[data-fg-tab]"), function (b) {
      b.setAttribute("aria-selected", b.getAttribute("data-fg-tab") === name ? "true" : "false");
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-fg-pane]"), function (p) {
      p.classList.toggle("fg-hidden", p.getAttribute("data-fg-pane") !== name);
    });
    refresh();
  }

  function confirmAction(title, text) {
    if (window.ServerGuard && typeof window.ServerGuard.ask === "function") {
      return window.ServerGuard.ask(title, text);
    }
    return Promise.resolve(window.confirm(text));
  }

  function act(action) {
    var label = ACTION_LABEL[action] || action;
    var go = CONFIRM[action]
      ? confirmAction(label, CONFIRM[action])
      : Promise.resolve(true);

    go.then(function (ok) {
      if (!ok) return;

      S.busy = true;
      renderStatus();

      return api("/" + action, "POST")
        .then(function (r) {
          toast(label + (r && r.output ? ": " + r.output : ": готово"));
        })
        .catch(function (e) {
          toast(label + ": " + e.message, true);
        })
        .then(function () {
          S.busy = false;
          S.loading = false;
          return refresh();
        });
    });
  }

  /* ---------- lifecycle ---------- */

  function init(rootEl) {
    destroy();

    root = rootEl || document.getElementById("fg-root");
    if (!root) return;

    onRootClick = function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-fg-act],[data-fg-tab],[data-fg='refresh']") : null;
      if (!t || !root.contains(t)) return;
      if (t.hasAttribute("data-fg-act")) act(t.getAttribute("data-fg-act"));
      else if (t.hasAttribute("data-fg-tab")) setTab(t.getAttribute("data-fg-tab"));
      else refresh();
    };
    root.addEventListener("click", onRootClick);

    q("eventSearch").addEventListener("input", renderEvents);
    q("typeFilter").addEventListener("change", renderEvents);
    q("baseSearch").addEventListener("input", renderBaseline);
    q("onlyDrift").addEventListener("change", renderBaseline);

    timer = setInterval(function () {
      if (!root || !root.isConnected) { destroy(); return; }
      if (q("auto").checked && !S.busy && !document.hidden && !root.hidden) refresh();
    }, POLL_MS);

    if (!root.hidden) refresh();
  }

  function destroy() {
    if (timer) { clearInterval(timer); timer = null; }
    if (root && onRootClick) root.removeEventListener("click", onRootClick);
    onRootClick = null;
    root = null;
    S.loading = false;
  }

  window.FileGuardModule = { init: init, destroy: destroy };

  // Регистрация в ServerGuard core: данные грузятся при открытии вкладки.
  if (window.ServerGuard && typeof window.ServerGuard.registerModule === "function") {
    window.ServerGuard.registerModule("fileguard", {
      initialLoad: function () { S.loading = false; return refresh(); },
      onShow: function () { S.loading = false; refresh(); }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.getElementById("fg-root")) init();
    });
  } else if (document.getElementById("fg-root")) {
    init();
  }
})();