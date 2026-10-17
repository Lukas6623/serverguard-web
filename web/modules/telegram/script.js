
"use strict";

// ============================================================
// MODULE: TELEGRAM BOT
// ============================================================

(function () {
    const {
        $,
        api,
        ask,
        createLogger,
        setBusy,
        isBusy,
        registerModule
    } = window.ServerGuard;

    const TEL = p => "/api/telegram/" + p;
    const addLog = createLogger("telegramLog");

    let status = null;

    // ========================================================
    // STATUS
    // ========================================================

    async function refreshStatus() {
        if (isBusy()) return;

        try {
            const r = await api(TEL("status"));

            if (!r.ok) {
                throw new Error(
                    r.data?.error || ("HTTP " + r.status)
                );
            }

            status = r.data;

            renderStats();
            renderInfo();
            renderActions();
        } catch (e) {
            addLog("Статус: " + e.message, false);
        }
    }

    // ========================================================
    // STATS
    // ========================================================

    function renderStats() {
        const s = status || {};

        const items = [
            [
                "Установлен",
                s.installed,
                s.installed ? "Да" : "Нет",
                s.installed ? "ok" : "warn"
            ],
            [
                "Скрипт",
                s.script,
                s.script ? "Есть" : "Нет",
                s.script ? "ok" : "warn"
            ],
            [
                "Служба",
                s.active,
                s.active ? "Работает" : "Остановлена",
                s.active ? "ok" : (s.installed ? "bad" : "warn")
            ],
            [
                "Автозапуск",
                s.enabled,
                s.enabled ? "Включён" : "Выключен",
                s.enabled ? "ok" : "warn"
            ],
            [
                "Конфигурация",
                s.config,
                s.config ? "Есть" : "Нет",
                s.config ? "ok" : "warn"
            ],
            [
                "requirements",
                s.requirements,
                s.requirements ? "Есть" : "Нет",
                s.requirements ? "ok" : "warn"
            ]
        ];

        const box = $("telegramStats");
        if (!box) return;

        box.innerHTML = "";

        items.forEach(([label, , value, cls]) => {
            const d = document.createElement("div");

            d.className = "stat " + cls;
            d.innerHTML = "<span></span><b></b>";

            d.firstChild.textContent = label;
            d.lastChild.textContent = value;

            box.append(d);
        });
    }

    // ========================================================
    // INFO
    // ========================================================

    function renderInfo() {
        const s = status || {};
        const box = $("telegramInfo");

        if (!box) return;

        box.innerHTML = "";

        const service =
            s.service || "serverguard-telegram.service";

        const directory =
            s.directory || "/opt/serverguard/telegram";

        const cards = [
            ["Служба", service],
            ["Каталог", directory],
            [
                "Конфигурация",
                s.config ? "Найдена" : "Не найдена"
            ],
            [
                "Python script",
                s.script ? "Найден" : "Не найден"
            ]
        ];

        cards.forEach(([label, value]) => {
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

    // ========================================================
    // ACTIONS
    // ========================================================

    const ACTIONS = [
        {
            id: "install",
            label: "Установить",
            desc: "Установить Telegram Bot и службу",
            path: "install",
            primary: true,
            can: s => !s.installed || !s.script,
            timeout:
                "Установка Telegram Bot может занять несколько минут."
        },
        {
            id: "start",
            label: "Запустить",
            desc: "Запустить Telegram Bot",
            path: "start",
            can: s => s.installed && !s.active
        },
        {
            id: "stop",
            label: "Остановить",
            desc: "Остановить Telegram Bot",
            path: "stop",
            danger: true,
            can: s => s.installed && (s.active || s.enabled),
            confirm: "Остановить Telegram Bot?"
        },
        {
            id: "restart",
            label: "Перезапустить",
            desc: "systemctl restart",
            path: "restart",
            can: s => s.installed
        },
        {
            id: "disable",
            label: "Отключить автозапуск",
            desc: "Не запускать после перезагрузки",
            path: "disable",
            danger: true,
            can: s => s.installed && s.enabled,
            confirm:
                "Отключить автоматический запуск Telegram Bot после перезагрузки?"
        },
        {
            id: "update",
            label: "Обновить",
            desc: "Обновить Telegram Bot из GitHub",
            path: "update",
            can: s => s.script,
            confirm: "Обновить Telegram Bot из GitHub?",
            timeout: "Обновление может занять некоторое время."
        },
        {
            id: "generate-code",
            label: "Сгенерировать код",
            desc: "Создать новый код привязки",
            path: "generate-code",
            can: s => s.installed || s.script
        },
        {
            id: "remove",
            label: "Удалить",
            desc: "Удалить Telegram Bot с сервера",
            path: "remove",
            danger: true,
            can: s => s.installed || s.script,
            confirm: "Удалить Telegram Bot с сервера?"
        }
    ];

    function renderActions() {
        const box = $("telegramActions");
        if (!box) return;

        box.innerHTML = "";

        ACTIONS.forEach(a => {
            const b = document.createElement("button");

            b.className =
                "btn" +
                (a.primary ? " primary" : "") +
                (a.danger ? " danger" : "");

            b.innerHTML = "<b></b><small></small>";

            b.firstChild.textContent = a.label;
            b.lastChild.textContent = a.desc;

            b.disabled =
                isBusy() ||
                !status ||
                !a.can(status);

            b.onclick = () => runAction(a);

            box.append(b);
        });
    }

    // ========================================================
    // RUN ACTION
    // ========================================================

    async function runAction(a) {
        if (isBusy()) return;

        let payload;

        // Для установки обязателен токен от BotFather.
        if (a.id === "install") {
            const tokenInput = $("telegramToken");
            const token = tokenInput
                ? tokenInput.value.trim()
                : "";

            if (!token) {
                addLog(
                    "Введите токен Telegram Bot перед установкой.",
                    false
                );

                if (tokenInput) tokenInput.focus();
                return;
            }

            // Формат токена Telegram Bot:
            // числовой ID, двоеточие и строка токена.
            if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
                addLog(
                    "Неверный формат токена. Проверьте токен от @BotFather.",
                    false
                );

                if (tokenInput) tokenInput.focus();
                return;
            }

            payload = { token: token };
        }

        if (a.confirm && !(await ask(a.label, a.confirm))) {
            return;
        }

        setBusy(true);

        addLog(
            a.label + "…" +
            (a.timeout ? " " + a.timeout : ""),
            true
        );

        try {
            let r;

            if (a.id === "install") {
                // Токен передаётся в JSON-теле POST-запроса.
                r = await api(TEL(a.path), "POST", payload);
            } else {
                r = await api(TEL(a.path), "POST");
            }

            const data = r.data || {};
            const ok = r.ok && data.ok !== false;

            let message =
                a.label + (ok ? ": выполнено" : ": ошибка");

            if (!ok && data.error) {
                message += " — " + data.error;
            }

            addLog(message, ok);

            if (
                data.installed !== undefined ||
                data.active !== undefined ||
                data.enabled !== undefined
            ) {
                status = data;

                renderStats();
                renderInfo();
            }

            if (a.id === "install") {
                const tokenInput = $("telegramToken");

                // Убираем токен из поля после ответа сервера.
                if (tokenInput) tokenInput.value = "";
            }

            if (a.id === "generate-code") {
                addLog(
                    ok
                        ? "Запрос на создание нового кода привязки выполнен."
                        : "Не удалось сгенерировать код привязки.",
                    ok
                );
            }
        } catch (e) {
            addLog(
                a.label + ": ошибка запроса — " + e.message,
                false
            );

            if (a.id === "install") {
                const tokenInput = $("telegramToken");
                if (tokenInput) tokenInput.value = "";
            }
        } finally {
            setBusy(false);
        }

        await refreshStatus();
    }

    // ========================================================
    // LOGS
    // ========================================================

    const logsButton = $("telegramLogsBtn");

    if (logsButton) {
        logsButton.onclick = loadLogs;
    }

    async function loadLogs() {
        if (isBusy()) return;

        setBusy(true);

        const output = $("telegramOut");

        if (output) output.textContent = "Загрузка…";

        try {
            const r = await api(TEL("logs"));
            const data = r.data || {};

            const logs =
                data.logs ??
                data.text ??
                data.error ??
                "Пустой ответ";

            if (output) {
                output.textContent =
                    String(logs).trim() || "Логов нет.";
            }

            if (!r.ok) {
                addLog(
                    "Не удалось загрузить логи Telegram.",
                    false
                );
            }
        } catch (e) {
            if (output) {
                output.textContent =
                    "Не удалось получить логи Telegram Bot.";
            }

            addLog("Загрузка логов: " + e.message, false);
        } finally {
            setBusy(false);
        }
    }

    // ========================================================
    // MANUAL REFRESH
    // ========================================================

    const refreshButton = $("telegramRefreshBtn");

    if (refreshButton) {
        refreshButton.addEventListener("click", refreshStatus);
    }

    // ========================================================
    // REGISTRATION
    // ========================================================

    registerModule("telegram", {
        onShow: refreshStatus,
        onBusyChange: renderActions,
        initialLoad: refreshStatus,
        autoRefresh: {
            checkboxId: "telegramAuto",
            intervalMs: 15000,
            fn: refreshStatus
        }
    });
})();
