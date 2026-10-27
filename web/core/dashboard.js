/* Dashboard reads only the existing same-origin ServerGuard API.
 * A successful stats response retains the original frontend's meaning;
 * it is not an independent verification of the remote SSH session.
 */
(function () {
    "use strict";

    const { $, syncBackend } = window.ServerGuard;
    const metricIds = ["statCpu", "statMemory", "statDisk", "statUptime", "statNetwork"];
    const infoIds = ["infoHostname", "infoOs", "infoKernel", "infoCpu", "infoLoad", "infoProcesses"];
    const fields = [
        "hostname", "host", "name", "cpu_percent", "cpu", "memory_percent", "mem_percent",
        "disk_percent", "disk", "uptime", "network_rx_speed", "network_tx_speed", "network",
        "network_total", "cpu_model", "cpu_name", "processor", "os", "operating_system",
        "platform", "kernel", "kernel_version", "load1", "load", "load_average", "processes", "process_count"
    ];
    const state = { backend: null, data: null, loading: false, error: "", updatedAt: null };
    let started = false;
    let lastHealthCheck = 0;
    let timer;

    function present(value) {
        return (typeof value === "number" && Number.isFinite(value) && value >= 0) ||
            (typeof value === "string" && value.trim() !== "");
    }

    function first(...values) {
        return values.find(present);
    }

    function text(id, value) {
        const next = present(value) ? String(value) : "—";
        if ($(id).textContent !== next) $(id).textContent = next;
    }

    function number(value) {
        if (!present(value)) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }

    function percent(value) {
        if (typeof value === "number") return present(value) ? value.toFixed(1) + "%" : "—";
        return present(value) ? value : "—";
    }

    function bytes(value, speed = false) {
        let amount = number(value);
        if (amount === null) return "—";
        const units = ["B", "KB", "MB", "GB", "TB"];
        let unit = 0;
        while (amount >= 1024 && unit < units.length - 1) {
            amount /= 1024;
            unit++;
        }
        return amount.toFixed(unit ? 1 : 0) + " " + units[unit] + (speed ? "/s" : "");
    }

    function uptime(value) {
        if (typeof value !== "number") return value;
        if (!present(value)) return "—";
        const days = Math.floor(value / 86400);
        const hours = Math.floor(value % 86400 / 3600);
        const minutes = Math.floor(value % 3600 / 60);
        return days ? `${days} д ${hours} ч` : hours ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
    }

    function render() {
        const data = state.data;
        const online = state.backend === true && data !== null;
        const checking = state.loading && (state.interactive || state.backend === null);
        document.body.dataset.connection = online ? "online" : "offline";
        $("connDot").className = "dot " + (online ? "on" : "off");
        text("connText", online ? "ONLINE · данные сервера" : "OFFLINE");
        text("serverStatus", online ? "ONLINE" : "OFFLINE");
        text("serverStatusText", state.loading ? "Обновление…" : online ? "Данные получены из API" : "Нет данных сервера");
        text("serverInfoStatus", online ? "Данные из API" : "Нет данных");
        text("activityLive", online ? "ONLINE" : "OFFLINE");
        text("backendStatus", "API: " + (state.backend === true ? "доступен" : state.backend === false ? "недоступен" : "проверка…"));
        $("serverMetrics").setAttribute("aria-busy", String(state.loading));
        $("refreshDashboard").disabled = state.loading;
        $("refreshDashboard").setAttribute("aria-busy", String(state.loading));
        $("refreshDashboard").classList.toggle("is-loading", state.loading);
        text("lastUpdated", state.updatedAt ? "Обновлено в " + state.updatedAt.toLocaleTimeString("ru-RU") : "Данные ещё не получены");
        $("connectionNotice").hidden = online;
        text("connectionTitle", checking ? "Проверяем соединение" : "Подключите удалённый сервер");
        text("connectionMessage", checking
            ? "Запрашиваем данные через ServerGuard. Локальные показатели компьютера не используются."
            : state.error || "Выберите сервер и откройте SSH-сессию в приложении ServerGuard. Здесь появятся его реальные показатели.");
        if (!online) {
            [...metricIds, ...infoIds].forEach(id => text(id, null));
            text("serverTitle", "Удалённый сервер не подключён");
            text("activityMessage", state.error || "Ожидание данных удалённого сервера.");
            text("activityTime", null);
            return;
        }

        const hostname = first(data.hostname, data.host, data.name);
        // API values are always rendered as text, including the hostname.
        text("serverTitle", hostname || "Данные удалённого сервера");
        text("infoHostname", hostname);
        text("statCpu", percent(first(data.cpu_percent, data.cpu)));
        text("statMemory", percent(first(data.memory_percent, data.mem_percent)));
        text("statDisk", percent(first(data.disk_percent, data.disk)));
        text("statUptime", uptime(data.uptime));
        const rx = number(data.network_rx_speed);
        const tx = number(data.network_tx_speed);
        if (rx !== null || tx !== null) {
            text("statNetwork", `↓ ${bytes(data.network_rx_speed, true)} / ↑ ${bytes(data.network_tx_speed, true)}`);
        } else {
            const total = first(data.network, data.network_total);
            text("statNetwork", typeof total === "number" ? bytes(total) : total);
        }
        text("infoCpu", first(data.cpu_model, data.cpu_name, data.processor));
        text("infoOs", first(data.os, data.operating_system, data.platform));
        text("infoKernel", first(data.kernel, data.kernel_version));
        const load = first(data.load1, data.load, data.load_average);
        text("infoLoad", typeof load === "number" ? load.toFixed(2) : load);
        text("infoProcesses", first(data.processes, data.process_count));
        text("activityTime", state.updatedAt.toLocaleTimeString("ru-RU"));
        text("activityMessage", "Получены данные выбранного сервера через API ServerGuard.");
    }

    async function readJSON(path) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(path, {
                method: "GET", cache: "no-store", credentials: "same-origin", signal: controller.signal
            });
            if (!response.ok) {
                const error = new Error(response.status === 401
                    ? "Нет доступа. Откройте ссылку с токеном из консоли ServerGuard."
                    : `Ответ ${path}: HTTP ${response.status}.`);
                error.httpStatus = response.status;
                throw error;
            }
            const data = await response.json();
            // Do not invent a health-response schema: the old frontend only parsed its JSON.
            // The stats endpoint, however, must supply its existing object fields to render data.
            if (data === null || data === false || data.error || data.ok === false ||
                (path === "/api/server/stats" && (typeof data !== "object" || Array.isArray(data)))) {
                throw new Error(`API ${path} не вернул доступные данные.`);
            }
            return data;
        } catch (error) {
            if (error.name === "AbortError" || error.name === "TypeError") {
                const unavailable = new Error(error.name === "AbortError"
                    ? "ServerGuard не ответил за 8 секунд." : "Нет связи с API ServerGuard.");
                unavailable.connectionLost = true;
                throw unavailable;
            }
            if (error instanceof SyntaxError) throw new Error("ServerGuard вернул ответ в неожиданном формате.");
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    async function refresh(manual = false) {
        if (!started || state.loading) return;
        clearTimeout(timer);
        state.loading = true;
        state.interactive = manual;
        render();
        try {
            if (manual || state.backend !== true || Date.now() - lastHealthCheck >= 10000) {
                try {
                    await readJSON("/api/health");
                    state.backend = true;
                    lastHealthCheck = Date.now();
                } catch (error) {
                    state.backend = false;
                    syncBackend(false);
                    throw error;
                }
            }
            // The existing /api/modules response alone decides which modules are available.
            // Reconnect and a manual refresh retry the list; module failures don't imply SSH failure.
            void syncBackend(true, manual);
            const data = await readJSON("/api/server/stats");
            if (!fields.some(key => present(data[key]))) {
                throw new Error("API не вернул данные сервера. Убедитесь, что выбран удалённый сервер и открыта SSH-сессия.");
            }
            if (state.data === null && !manual) void syncBackend(true, true);
            state.data = data;
            state.updatedAt = new Date();
            state.error = "";
        } catch (error) {
            if (error.httpStatus === 401 || error.connectionLost) {
                state.backend = false;
                syncBackend(false);
            }
            state.data = null;
            state.error = error.message + " Подключение к удалённому серверу не подтверждено.";
        } finally {
            state.loading = false;
            render();
            if (!document.hidden) timer = setTimeout(refresh, 3000);
        }
    }

    document.addEventListener("serverguard:ready", () => {
        started = true;
        $("refreshDashboard").addEventListener("click", () => refresh(true));
        void refresh(true);
    }, { once: true });
    document.addEventListener("visibilitychange", () => {
        clearTimeout(timer);
        if (!document.hidden) void refresh(true);
    });
    render();
})();
