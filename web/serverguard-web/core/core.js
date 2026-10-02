"use strict";

// ============================================================
// core.js — ЯДРО приложения.
//
// Общая инфраструктура, которую используют ВСЕ модули:
//   - $                    — document.getElementById
//   - api(path, method)    — единая очередь запросов к серверу
//                             (запросы выполняются строго по очереди,
//                             чтобы не открывать параллельно
//                             несколько SSH-каналов)
//   - setBusy / isBusy     — глобальное состояние "идёт операция"
//   - banner(msg)          — баннер ошибки/подключения наверху
//   - createLogger(ulId)   — фабрика функции addLog(text, ok) для
//                             журнала действий модуля
//   - ask(title, text)     — модальный диалог подтверждения
//   - registerModule(id,…) — регистрация модуля (см. контракт ниже)
//
// ------------------------------------------------------------
// КАК ДОБАВИТЬ НОВЫЙ МОДУЛЬ
// ------------------------------------------------------------
//   1. Создать папку modules/<id>/ с файлами:
//        index.html — разметка <section data-module="<id>" hidden>…</section>
//        style.css   — стили, специфичные только для этого модуля
//        script.js   — логика модуля (обёрнутая в IIFE), в конце
//                      вызывает ServerGuard.registerModule("<id>", {...})
//   2. Добавить одну строку в MODULE_MANIFEST ниже.
//   3. Ничего в index.html и core.js больше менять не нужно —
//      модуль подхватится автоматически при следующей загрузке.
//
// ------------------------------------------------------------
// КОНТРАКТ МОДУЛЯ (объект, который передаётся в registerModule)
// ------------------------------------------------------------
//   {
//     onShow:       () => {}   // вызывается при открытии вкладки модуля
//     onBusyChange: () => {}   // вызывается при смене busy — обычно
//                               // сюда передают функцию перерисовки кнопок
//     initialLoad:  () => {}   // вызывается один раз при старте приложения,
//                               // если модуль включён на сервере (moduleState)
//     autoRefresh: {
//         checkboxId: "...",   // id чекбокса "обновлять статус"
//         intervalMs: 15000,
//         fn: () => {}
//     }
//   }
//   Все поля необязательны.
// ============================================================

window.ServerGuard = (function ()
{

const $ = id => document.getElementById(id);


// ------------------------------------------------------------
// API QUEUE
// ------------------------------------------------------------

let chain = Promise.resolve();

function api(path, method = "GET")
{
    const run = () =>
        fetch(path, { method })
        .then(async r =>
        {
            let d = {};

            try { d = await r.json(); }
            catch (e) {}

            return { ok: r.ok, status: r.status, data: d };
        });

    const p = chain.then(run);

    chain = p.catch(() => {});

    return p;
}


// ------------------------------------------------------------
// BUSY STATE
// ------------------------------------------------------------

let busy = false;

const busyListeners = [];

function setBusy(v)
{
    busy = v;

    document.body.classList.toggle("busy", v);

    busyListeners.forEach(fn => fn());
}

function isBusy()
{
    return busy;
}


// ------------------------------------------------------------
// BANNER
// ------------------------------------------------------------

function banner(msg)
{
    const b = $("banner");

    b.textContent = msg || "";

    b.classList.toggle("show", !!msg);
}


// ------------------------------------------------------------
// LOGGER FACTORY
// ------------------------------------------------------------

function createLogger(ulId)
{
    return function (text, ok)
    {
        const ul = $(ulId);

        if (!ul) return;

        if (ul.querySelector(".sub"))
        {
            ul.innerHTML = "";
        }

        const li = document.createElement("li");
        const t = document.createElement("time");

        t.textContent = new Date().toLocaleTimeString();

        const s = document.createElement("span");

        s.textContent = text;
        s.className = ok ? "ok" : "bad";

        li.append(t, s);

        ul.prepend(li);
    };
}


// ------------------------------------------------------------
// CONFIRM DIALOG
// ------------------------------------------------------------

function ask(title, text)
{
    return new Promise(res =>
    {
        $("dlgTitle").textContent = title;
        $("dlgText").textContent = text;

        const d = $("dlg");

        d.showModal();

        const done = v =>
        {
            d.close();

            $("dlgYes").onclick = null;
            $("dlgNo").onclick = null;

            res(v);
        };

        $("dlgYes").onclick = () => done(true);
        $("dlgNo").onclick = () => done(false);

        d.oncancel = () => done(false);
    });
}


// ------------------------------------------------------------
// MODULE MANIFEST
//
// Порядок здесь = порядок вкладок в сайдбаре.
// ------------------------------------------------------------

const MODULE_MANIFEST =
[
    { id: "sshkeys",   name: "SSH Key Guard" },
    { id: "security",  name: "Security" },
    { id: "telegram",  name: "Telegram Bot" },
    { id: "hardening", name: "SSH Hardening" },
    { id: "fileguard", name: "FileGuard" }
];


// ------------------------------------------------------------
// MODULE REGISTRY
// ------------------------------------------------------------

const registry = {};

function registerModule(id, impl)
{
    registry[id] = impl || {};

    if (impl && impl.onBusyChange)
    {
        busyListeners.push(impl.onBusyChange);
    }

    if (impl && impl.autoRefresh)
    {
        const { checkboxId, intervalMs, fn } = impl.autoRefresh;

        setInterval(() =>
        {
            const box = $(checkboxId);

            if (
                box &&
                box.checked &&
                !document.hidden &&
                currentModule === id
            )
            {
                fn();
            }
        }, intervalMs || 15000);
    }
}


// ------------------------------------------------------------
// NAV / MODULE SWITCHING
// ------------------------------------------------------------

let moduleState = {};

let currentModule = MODULE_MANIFEST[0].id;

function renderNav()
{
    const nav = $("nav");

    nav.innerHTML = "";

    MODULE_MANIFEST.forEach(m =>
    {
        const sectionPresent =
            !!document.querySelector('section[data-module="' + m.id + '"]');

        const ready = !!moduleState[m.id] && sectionPresent;

        const b = document.createElement("button");

        b.disabled = !ready;

        b.className = m.id === currentModule ? "active" : "";

        b.innerHTML = "<span></span><small></small>";

        b.firstChild.textContent = m.name;

        b.lastChild.textContent = ready ? "" : "скоро";

        b.onclick = () =>
        {
            currentModule = m.id;

            showModule();
            renderNav();

            const impl = registry[m.id];

            if (impl && impl.onShow)
            {
                impl.onShow();
            }
        };

        nav.append(b);
    });
}

function showModule()
{
    document.querySelectorAll("[data-module]").forEach(s =>
    {
        s.hidden = s.dataset.module !== currentModule;
    });
}


// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------

async function checkHealth()
{
    try
    {
        const r = await fetch("/api/health");

        if (r.status === 401)
        {
            $("connDot").className = "dot off";
            $("connText").textContent = "нет доступа";

            banner("Нет доступа. Откройте ссылку с токеном из консоли ServerGuard.");

            return null;
        }

        const d = await r.json();

        $("connDot").className = "dot on";
        $("connText").textContent = "ServerGuard онлайн";

        banner("");

        return d;
    }
    catch (e)
    {
        $("connDot").className = "dot off";
        $("connText").textContent = "нет связи";

        banner("Нет связи с ServerGuard. Убедитесь, что программа запущена и SSH-сессия открыта.");

        return null;
    }
}


// ------------------------------------------------------------
// LOAD MODULE STATE (/api/modules)
// ------------------------------------------------------------

async function loadModuleState()
{
    try
    {
        const r = await fetch("/api/modules");

        if (!r.ok) throw new Error("HTTP " + r.status);

        moduleState = await r.json();
    }
    catch (e)
    {
        moduleState = {};
    }

    renderNav();
}


// ------------------------------------------------------------
// LOADING MODULE ASSETS FROM modules/<id>/
// ------------------------------------------------------------

function loadStylesheet(href)
{
    return new Promise(resolve =>
    {
        const link = document.createElement("link");

        link.rel = "stylesheet";
        link.href = href;

        // Не блокируем загрузку приложения, если у модуля нет
        // собственного style.css или он не найден.
        link.onload = resolve;
        link.onerror = resolve;

        document.head.append(link);
    });
}

async function loadHtml(href, mount)
{
    const r = await fetch(href);

    if (!r.ok)
    {
        throw new Error("Не удалось загрузить " + href + " (HTTP " + r.status + ")");
    }

    const html = await r.text();

    mount.insertAdjacentHTML("beforeend", html);
}

function loadScript(src)
{
    return new Promise((resolve, reject) =>
    {
        const s = document.createElement("script");

        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error("Не удалось загрузить " + src));

        document.body.append(s);
    });
}

async function loadModuleAssets(id)
{
    const base = "modules/" + id + "/";

    await loadStylesheet(base + "style.css");
    await loadHtml(base + "index.html", $("main"));
    await loadScript(base + "script.js");
}


// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------

async function init()
{
    // Модули загружаются ПОСЛЕДОВАТЕЛЬНО: html модуля должен
    // появиться в DOM до того, как выполнится его script.js
    // (там ищутся элементы по id).

    for (const m of MODULE_MANIFEST)
    {
        try
        {
            await loadModuleAssets(m.id);
        }
        catch (e)
        {
            console.error("Не удалось загрузить модуль '" + m.id + "':", e);
        }
    }

    showModule();

    if (await checkHealth())
    {
        await loadModuleState();

        for (const m of MODULE_MANIFEST)
        {
            const impl = registry[m.id];

            if (moduleState[m.id] && impl && impl.initialLoad)
            {
                await impl.initialLoad();
            }
        }
    }
    else
    {
        renderNav();
    }

    setBusy(false);
}

setInterval(checkHealth, 10000);

document.addEventListener("DOMContentLoaded", init);


// ------------------------------------------------------------
// PUBLIC API
// ------------------------------------------------------------

return {
    $,
    api,
    setBusy,
    isBusy,
    banner,
    createLogger,
    ask,
    registerModule
};

})();
