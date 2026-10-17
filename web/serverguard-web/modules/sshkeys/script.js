"use strict";

// ============================================================
// MODULE: SSH KEY GUARD
//
// Использует общую инфраструктуру из window.ServerGuard
// (см. core/core.js). Весь код обёрнут в IIFE, чтобы не
// засорять глобальную область видимости — это важно, т.к.
// в будущем модулей станет больше и у них могут быть похожие
// имена функций/переменных (status, refreshStatus и т.д.).
// ============================================================

(function ()
{

const { $, api, ask, createLogger, setBusy, isBusy, registerModule } = window.ServerGuard;

const SK = p => "/api/sshkeyguard/" + p;

const addLog = createLogger("log");

let status = null;

let tab = "events";


// ============================================================
// STATUS
// ============================================================

async function refreshStatus()
{
    if (isBusy()) return;

    try
    {
        const r = await api(SK("status"));

        if (!r.ok)
        {
            throw new Error(r.data.error || ("HTTP " + r.status));
        }

        status = r.data;

        renderStats();
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
        ["Служба", s.active, s.active ? "Работает" : "Остановлена", s.active ? "ok" : (s.installed ? "bad" : "warn")],
        ["Автозапуск", s.enabled, s.enabled ? "Включён" : "Выключен", s.enabled ? "ok" : "warn"],
        ["auditd", s.auditd, s.auditd ? "Доступен" : "Нет", s.auditd ? "ok" : "warn"]
    ];

    $("stats").innerHTML = "";

    items.forEach(([label, , value, cls]) =>
    {
        const d = document.createElement("div");

        d.className = "stat " + cls;
        d.innerHTML = "<span></span><b></b>";
        d.firstChild.textContent = label;
        d.lastChild.textContent = value;

        $("stats").append(d);
    });
}


// ============================================================
// ACTIONS
// ============================================================

const ACTIONS =
[
    {
        id: "install", label: "Установить", desc: "Скрипт, служба, baseline, автозапуск",
        path: "install", primary: true, confirm: null,
        can: s => !s.installed || !s.script,
        timeout: "Установка может занять несколько минут. Ход установки виден в консоли ServerGuard."
    },
    {
        id: "start", label: "Запустить", desc: "Запустить защиту", path: "start",
        can: s => s.installed && !s.active
    },
    {
        id: "stop", label: "Остановить", desc: "Остановить защиту", path: "stop", danger: true,
        can: s => s.installed && (s.active || s.enabled),
        confirm: "Остановить защиту? Замена ключей перестанет отслеживаться."
    },
    {
        id: "restart", label: "Перезапустить", desc: "systemctl restart", path: "restart",
        can: s => s.installed
    },
    {
        id: "scan", label: "Сканировать сейчас", desc: "Сверить ключи с baseline", path: "scan",
        can: s => s.script
    },
    {
        id: "baseline", label: "Новый baseline", desc: "Принять текущие ключи как эталон", path: "baseline",
        can: s => s.script,
        confirm: "Текущий набор ключей станет эталоном."
    },
    {
        id: "audit", label: "Настроить auditd", desc: "Установка и правила аудита", path: "audit",
        can: s => s.script
    },
    {
        id: "update", label: "Обновить", desc: "Скачать новую версию из GitHub", path: "update",
        can: s => s.script,
        confirm: "Скрипт будет заменён версией из GitHub. При ошибке запуска произойдёт откат.",
        timeout: "Обновление может занять до минуты."
    },
    {
        id: "remove", label: "Удалить", desc: "Служба и скрипт (данные останутся)", path: "remove", danger: true,
        can: s => s.installed || s.script,
        confirm: "Удалить SSH Key Guard с сервера? Данные и бэкапы сохранятся."
    }
];

function renderActions()
{
    const box = $("actions");

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

    $("reloadOut").disabled = isBusy();
}


// ============================================================
// RUN ACTION
// ============================================================

async function runAction(a)
{
    if (isBusy()) return;

    if (a.confirm && !(await ask(a.label, a.confirm))) return;

    setBusy(true);

    addLog(a.label + "…" + (a.timeout ? " " + a.timeout : ""), true);

    try
    {
        const r = await api(SK(a.path), "POST");

        const ok = r.ok && r.data.ok !== false;

        addLog(a.label + (ok ? ": выполнено" : ": ошибка"), ok);

        if (r.data.installed !== undefined || r.data.active !== undefined)
        {
            status = r.data;

            renderStats();
        }
    }
    catch (e)
    {
        addLog(a.label + ": нет ответа от ServerGuard", false);
    }

    setBusy(false);

    refreshStatus();
}


// ============================================================
// EVENTS / LOGS TABS
// ============================================================

document.querySelectorAll("#view-sshkeys .tabs [data-tab]").forEach(b =>
{
    b.onclick = () =>
    {
        tab = b.dataset.tab;

        document.querySelectorAll("#view-sshkeys .tabs [data-tab]").forEach(x =>
        {
            x.classList.toggle("active", x === b);
        });

        loadOutput();
    };
});

$("reloadOut").onclick = loadOutput;

async function loadOutput()
{
    if (isBusy()) return;

    setBusy(true);

    $("out").textContent = "Загрузка…";

    try
    {
        const r = await api(SK(tab));

        let text = r.data.output ?? r.data.text ?? r.data.error ?? "Пустой ответ";

        try
        {
            text = JSON.stringify(JSON.parse(text), null, 2);
        }
        catch (e) {}

        $("out").textContent = text.trim() || "Данных нет.";
    }
    catch (e)
    {
        $("out").textContent = "Не удалось получить данные.";
    }

    setBusy(false);
}


// ============================================================
// REGISTRATION
// ============================================================

registerModule("sshkeys", {
    onBusyChange: renderActions,
    initialLoad: refreshStatus,
    autoRefresh: { checkboxId: "auto", intervalMs: 15000, fn: refreshStatus }
});

})();
