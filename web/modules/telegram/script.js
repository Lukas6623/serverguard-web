"use strict";

// ============================================================
// MODULE: TELEGRAM BOT
// ============================================================

(function ()
{

const { $, api, ask, createLogger, setBusy, isBusy, registerModule } = window.ServerGuard;

const TEL = p => "/api/telegram/" + p;

const addLog = createLogger("telegramLog");

let status = null;


// ============================================================
// STATUS
// ============================================================

async function refreshStatus()
{
    if (isBusy()) return;

    try
    {
        const r = await api(TEL("status"));

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
        ["Служба", s.active, s.active ? "Работает" : "Остановлена", s.active ? "ok" : (s.installed ? "bad" : "warn")],
        ["Автозапуск", s.enabled, s.enabled ? "Включён" : "Выключен", s.enabled ? "ok" : "warn"],
        ["Конфигурация", s.config, s.config ? "Есть" : "Нет", s.config ? "ok" : "warn"],
        ["requirements", s.requirements, s.requirements ? "Есть" : "Нет", s.requirements ? "ok" : "warn"]
    ];

    $("telegramStats").innerHTML = "";

    items.forEach(([label, , value, cls]) =>
    {
        const d = document.createElement("div");

        d.className = "stat " + cls;
        d.innerHTML = "<span></span><b></b>";
        d.firstChild.textContent = label;
        d.lastChild.textContent = value;

        $("telegramStats").append(d);
    });
}


// ============================================================
// INFO
// ============================================================

function renderInfo()
{
    const s = status || {};

    const box = $("telegramInfo");

    box.innerHTML = "";

    const service = s.service || "serverguard-telegram.service";
    const directory = s.directory || "/opt/serverguard/telegram";

    const cards =
    [
        ["Служба", service],
        ["Каталог", directory],
        ["Конфигурация", s.config ? "Найдена" : "Не найдена"],
        ["Python script", s.script ? "Найден" : "Не найден"]
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
}


// ============================================================
// ACTIONS
// ============================================================

const ACTIONS =
[
    {
        id: "install", label: "Установить", desc: "Установить Telegram Bot и службу",
        path: "install", primary: true, confirm: null,
        can: s => !s.installed || !s.script,
        timeout: "Установка Telegram Bot может занять несколько минут."
    },
    {
        id: "start", label: "Запустить", desc: "Запустить Telegram Bot", path: "start",
        can: s => s.installed && !s.active
    },
    {
        id: "stop", label: "Остановить", desc: "Остановить Telegram Bot", path: "stop", danger: true,
        can: s => s.installed && (s.active || s.enabled),
        confirm: "Остановить Telegram Bot?"
    },
    {
        id: "restart", label: "Перезапустить", desc: "systemctl restart", path: "restart",
        can: s => s.installed
    },
    {
        id: "disable", label: "Отключить автозапуск", desc: "Не запускать после перезагрузки",
        path: "disable", danger: true,
        can: s => s.installed && s.enabled,
        confirm: "Отключить автоматический запуск Telegram Bot после перезагрузки?"
    },
    {
        id: "update", label: "Обновить", desc: "Обновить Telegram Bot из GitHub", path: "update",
        can: s => s.script,
        confirm: "Обновить Telegram Bot из GitHub?",
        timeout: "Обновление может занять некоторое время."
    },
    {
        id: "generate-code", label: "Сгенерировать код", desc: "Создать новый код привязки",
        path: "generate-code",
        can: s => s.installed || s.script
    },
    {
        id: "remove", label: "Удалить", desc: "Удалить Telegram Bot", path: "remove", danger: true,
        can: s => s.installed || s.script,
        confirm: "Удалить Telegram Bot с сервера?"
    }
];

function renderActions()
{
    const box = $("telegramActions");

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

    addLog(a.label + "…" + (a.timeout ? " " + a.timeout : ""), true);

    try
    {
        const r = await api(TEL(a.path), "POST");

        const ok = r.ok && r.data.ok !== false;

        let message = a.label + (ok ? ": выполнено" : ": ошибка");

        if (!ok && r.data.error)
        {
            message += " — " + r.data.error;
        }

        addLog(message, ok);

        if (
            r.data.installed !== undefined ||
            r.data.active !== undefined ||
            r.data.enabled !== undefined
        )
        {
            status = r.data;

            renderStats();
            renderInfo();
        }

        if (a.id === "generate-code")
        {
            addLog(
                ok
                    ? "Новый код привязки сгенерирован."
                    : "Не удалось сгенерировать код привязки.",
                ok
            );
        }
    }
    catch (e)
    {
        addLog(a.label + ": нет ответа от ServerGuard", false);
    }

    setBusy(false);

    await refreshStatus();
}


// ============================================================
// LOGS
// ============================================================

$("telegramLogsBtn").onclick = loadLogs;

async function loadLogs()
{
    if (isBusy()) return;

    setBusy(true);

    $("telegramOut").textContent = "Загрузка…";

    try
    {
        const r = await api(TEL("logs"));

        let text = r.data.logs ?? r.data.text ?? r.data.error ?? "Пустой ответ";

        $("telegramOut").textContent = String(text).trim() || "Логов нет.";
    }
    catch (e)
    {
        $("telegramOut").textContent = "Не удалось получить логи Telegram Bot.";
    }

    setBusy(false);
}


// ============================================================
// REGISTRATION
// ============================================================

registerModule("telegram", {
    onShow: refreshStatus,
    onBusyChange: renderActions,
    initialLoad: refreshStatus,
    autoRefresh: { checkboxId: "telegramAuto", intervalMs: 15000, fn: refreshStatus }
});

})();
