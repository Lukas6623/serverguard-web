"use strict";

// ============================================================
// MODULE: SECURITY
// ============================================================

(function ()
{

const { $, api, ask, createLogger, setBusy, isBusy, registerModule } = window.ServerGuard;

const SEC = p => "/api/security/" + p;

const addLog = createLogger("securityLog");

let status = null;


// ============================================================
// STATUS
// ============================================================

async function refreshStatus()
{
    if (isBusy()) return;

    try
    {
        const r = await api(SEC("status"));

        if (!r.ok)
        {
            throw new Error(r.data.error || ("HTTP " + r.status));
        }

        status = r.data;

        renderStats();
        renderInfo();
        renderActions();
    }
    catch (e)
    {
        addLog("Статус: " + e.message, false);
    }
}


// ============================================================
// STATS
// ============================================================

function renderStats()
{
    const s = status || {};

    const items =
    [
        ["Установлен", s.installed, s.installed ? "Да" : "Нет", s.installed ? "ok" : "warn"],
        ["Скрипт", s.script, s.script ? "Есть" : "Нет", s.script ? "ok" : "warn"],
        ["Защита", s.active, s.active ? "Работает" : "Остановлена", s.active ? "ok" : (s.installed ? "bad" : "warn")],
        ["Автозапуск", s.enabled, s.enabled ? "Включён" : "Выключен", s.enabled ? "ok" : "warn"],
        ["UFW", s.ufwActive, s.ufwActive ? "Активен" : "Неактивен", s.ufwActive ? "ok" : "warn"]
    ];

    $("securityStats").innerHTML = "";

    items.forEach(([label, , value, cls]) =>
    {
        const d = document.createElement("div");

        d.className = "stat " + cls;
        d.innerHTML = "<span></span><b></b>";
        d.firstChild.textContent = label;
        d.lastChild.textContent = value;

        $("securityStats").append(d);
    });
}


// ============================================================
// INFO
// ============================================================

function renderInfo()
{
    const s = status || {};

    const box = $("securityInfo");

    box.innerHTML = "";

    const service = s.service || "serverguard-security.service";
    const script = s.scriptPath || "/opt/serverguard/brute_force_guard.py";

    const cards =
    [
        ["Служба", service],
        ["Скрипт", script],
        ["UFW установлен", s.ufwInstalled ? "Да" : "Нет"]
    ];

    cards.forEach(([label, value]) =>
    {
        const card = document.createElement("div");

        card.className = "info-card";

        const span = document.createElement("span");
        span.textContent = label;

        const b = document.createElement("b");
        b.textContent = value;

        card.append(span, b);

        box.append(card);
    });

    const portCard = document.createElement("div");
    portCard.className = "info-card";

    const portTitle = document.createElement("span");
    portTitle.textContent = "SSH порты";

    const portList = document.createElement("div");
    portList.className = "port-list";

    const ports = Array.isArray(s.sshPorts) ? s.sshPorts : [];

    if (ports.length === 0)
    {
        const empty = document.createElement("b");
        empty.textContent = "Не определены";
        portList.append(empty);
    }
    else
    {
        ports.forEach(port =>
        {
            const p = document.createElement("span");
            p.className = "port";
            p.textContent = "SSH " + port;
            portList.append(p);
        });
    }

    portCard.append(portTitle, portList);

    box.append(portCard);
}


// ============================================================
// ACTIONS
// ============================================================

const ACTIONS =
[
    {
        id: "install", label: "Установить", desc: "Установить brute-force защиту и UFW",
        path: "install", primary: true,
        can: s => !s.installed || !s.script
    },
    {
        id: "start", label: "Запустить", desc: "Запустить защиту", path: "start",
        can: s => s.installed && !s.active
    },
    {
        id: "stop", label: "Остановить", desc: "Остановить защиту", path: "stop", danger: true,
        can: s => s.installed && s.active,
        confirm: "Остановить Security? Защита от brute-force будет временно отключена."
    },
    {
        id: "disable", label: "Отключить автозапуск", desc: "Не запускать защиту после перезагрузки",
        path: "disable", danger: true,
        can: s => s.installed && s.enabled,
        confirm: "Отключить автоматический запуск Security после перезагрузки?"
    },
    {
        id: "update", label: "Обновить", desc: "Обновить brute_force_guard.py", path: "update",
        can: s => s.script,
        confirm: "Обновить Security из GitHub?"
    }
];

function renderActions()
{
    const box = $("securityActions");

    if (!box) return;

    box.innerHTML = "";

    ACTIONS.forEach(a =>
    {
        const b = document.createElement("button");

        b.className = "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : "");
        b.innerHTML = "<b></b><small></small>";
        b.firstChild.textContent = a.label;
        b.lastChild.textContent = a.desc;
        b.disabled = isBusy() || !status || !a.can(status);
        b.onclick = () => runAction(a);

        box.append(b);
    });
}


// ============================================================
// RUN ACTION
// ============================================================

async function runAction(a)
{
    if (isBusy()) return;

    if (a.confirm && !(await ask(a.label, a.confirm))) return;

    setBusy(true);

    addLog(a.label + "…", true);

    try
    {
        const r = await api(SEC(a.path), "POST");

        const ok = r.ok && r.data.ok !== false;

        addLog(a.label + (ok ? ": выполнено" : ": ошибка"), ok);
    }
    catch (e)
    {
        addLog(a.label + ": нет ответа от ServerGuard", false);
    }

    setBusy(false);

    refreshStatus();
}


// ============================================================
// LOGS
// ============================================================

$("securityLogsBtn").onclick = loadLogs;

async function loadLogs()
{
    if (isBusy()) return;

    setBusy(true);

    $("securityOut").textContent = "Загрузка…";

    try
    {
        const r = await api(SEC("logs"));

        let text = r.data.logs ?? r.data.text ?? r.data.error ?? "Пустой ответ";

        $("securityOut").textContent = text.trim() || "Логов нет.";
    }
    catch (e)
    {
        $("securityOut").textContent = "Не удалось получить логи Security.";
    }

    setBusy(false);
}


// ============================================================
// REGISTRATION
// ============================================================

registerModule("security", {
    onShow: refreshStatus,
    onBusyChange: renderActions,
    initialLoad: refreshStatus,
    autoRefresh: { checkboxId: "securityAuto", intervalMs: 15000, fn: refreshStatus }
});

})();
