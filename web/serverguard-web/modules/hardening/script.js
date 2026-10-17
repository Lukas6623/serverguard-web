"use strict";

// ============================================================
// MODULE: SSH HARDENING
// ============================================================

(function ()
{

const { $, api, ask, createLogger, setBusy, isBusy, registerModule } = window.ServerGuard;

const HARD = p => "/api/hardening/" + p;

const addLog = createLogger("hardeningLog");

let status = null;


// ============================================================
// STATUS
// ============================================================

async function refreshStatus()
{
    if (isBusy()) return;

    try
    {
        const r = await api(HARD("status"));

        if (!r.ok)
        {
            throw new Error(r.data.error || ("HTTP " + r.status));
        }

        status = r.data;

        renderStats();
        renderInfo();
        renderParameters();
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
        ["SSH Hardening", s.enabled, s.enabled ? "Активен" : "Не применён", s.enabled ? "ok" : "warn"],
        ["SSH service", s.sshActive, s.sshActive ? "Работает" : "Не работает", s.sshActive ? "ok" : "bad"],
        ["Конфигурация", s.configValid, s.configValid ? "Корректна" : "Ошибка", s.configValid ? "ok" : "bad"]
    ];

    $("hardeningStats").innerHTML = "";

    items.forEach(([label, , value, cls]) =>
    {
        const d = document.createElement("div");

        d.className = "stat " + cls;
        d.innerHTML = "<span></span><b></b>";
        d.firstChild.textContent = label;
        d.lastChild.textContent = value;

        $("hardeningStats").append(d);
    });
}


// ============================================================
// INFO
// ============================================================

function renderInfo()
{
    const s = status || {};

    const box = $("hardeningInfo");

    box.innerHTML = "";

    const cards =
    [
        ["Скрипт", s.scriptPath || "/opt/serverguard/ssh_hardening.py"],
        ["SSH конфигурация", s.configPath || "/etc/ssh/sshd_config"],
        ["Hardening config", s.hardeningConfig || "/etc/ssh/sshd_config.d/99-serverguard-hardening.conf"],
        ["PermitRootLogin", s.permitRootLogin ?? "не определено"]
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
// PARAMETERS
// ============================================================

function parameterCard(label, value, good)
{
    const d = document.createElement("div");

    d.className = "hardening-item " + (good ? "good" : "warning");

    const span = document.createElement("span");
    span.textContent = label;

    const b = document.createElement("b");
    b.textContent = value ?? "не определено";

    d.append(span, b);

    return d;
}

function renderParameters()
{
    const s = status || {};

    const box = $("hardeningParameters");

    box.innerHTML = "";

    box.append(parameterCard(
        "PermitRootLogin",
        s.permitRootLogin,
        s.permitRootLogin === "prohibit-password" || s.permitRootLogin === "without-password"
    ));

    box.append(parameterCard(
        "PermitEmptyPasswords",
        s.permitEmptyPasswords,
        s.permitEmptyPasswords === "no"
    ));

    box.append(parameterCard(
        "MaxAuthTries",
        s.maxAuthTries,
        String(s.maxAuthTries) === "3"
    ));

    box.append(parameterCard(
        "LoginGraceTime",
        s.loginGraceTime,
        String(s.loginGraceTime) === "30"
    ));

    box.append(parameterCard(
        "X11Forwarding",
        s.x11Forwarding,
        s.x11Forwarding === "no"
    ));

    box.append(parameterCard(
        "AllowTcpForwarding",
        s.allowTcpForwarding,
        s.allowTcpForwarding === "no"
    ));

    box.append(parameterCard(
        "AllowAgentForwarding",
        s.allowAgentForwarding,
        s.allowAgentForwarding === "no"
    ));

    box.append(parameterCard(
        "Compression",
        s.compression,
        s.compression === "no"
    ));
}


// ============================================================
// ACTIONS
// ============================================================

const ACTIONS =
[
    {
        id: "install", label: "Установить", desc: "Скачать и установить SSH Hardening",
        path: "install", primary: true, confirm: null,
        can: s => !s.installed,
        timeout: "Установка может занять несколько минут."
    },
    {
        id: "apply", label: "Применить Hardening", desc: "Усилить конфигурацию SSH",
        path: "apply", primary: true,
        can: s => !!s.installed,
        confirm: "Применить SSH Hardening? Конфигурация SSH будет изменена, после чего выполнится проверка."
    },
    {
        id: "validate", label: "Проверить конфигурацию", desc: "sshd -t и проверка настроек",
        path: "validate",
        can: s => !!s.installed
    },
    {
        id: "update", label: "Обновить", desc: "Скачать новый ssh_hardening.py",
        path: "update",
        can: s => !!s.installed,
        confirm: "Обновить SSH Hardening из GitHub? Перед обновлением текущая версия сохраняется."
    },
    {
        id: "remove", label: "Удалить", desc: "Удалить SSH Hardening",
        path: "remove", danger: true,
        can: s => !!s.installed,
        confirm: "Удалить SSH Hardening? Скрипт будет удалён с сервера. Текущая конфигурация SSH автоматически не восстанавливается."
    }
];

function renderActions()
{
    const box = $("hardeningActions");

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
        const r = await api(HARD(a.path), "POST");

        const ok = r.ok && r.data.ok !== false;

        let message = a.label + (ok ? ": выполнено" : ": ошибка");

        if (!ok && r.data.error)
        {
            message += " — " + r.data.error;
        }

        addLog(message, ok);

        if (
            r.data.installed !== undefined ||
            r.data.enabled !== undefined ||
            r.data.configValid !== undefined
        )
        {
            status = r.data;

            renderStats();
            renderInfo();
            renderParameters();
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
// BACKUPS
// ============================================================

$("hardeningBackupsBtn").onclick = loadBackups;

async function loadBackups()
{
    if (isBusy()) return;

    setBusy(true);

    $("hardeningBackupsOut").textContent = "Загрузка…";

    try
    {
        const r = await api(HARD("backups"));

        let text = r.data.text ?? r.data.error ?? r.data.path ?? "Бэкапов нет.";

        $("hardeningBackupsOut").textContent = text.trim() || "Бэкапов нет.";
    }
    catch (e)
    {
        $("hardeningBackupsOut").textContent = "Не удалось получить список бэкапов.";
    }

    setBusy(false);
}


// ============================================================
// REGISTRATION
// ============================================================

registerModule("hardening", {
    onShow: refreshStatus,
    onBusyChange: renderActions,
    initialLoad: refreshStatus,
    autoRefresh: { checkboxId: "hardeningAuto", intervalMs: 15000, fn: refreshStatus }
});

})();
