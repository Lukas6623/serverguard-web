# ServerGuard — веб-интерфейс

Активная версия панели находится в этой папке `web/`. Вложенная копия
`serverguard-web/` не синхронизировалась: её роль в упаковке приложения
пока не установлена. Это панель выбранного удалённого Linux-сервера.

Backend и CLI в этом репозитории отсутствуют. `python3 -m http.server
8765 --bind 127.0.0.1 --directory web` из корня репозитория позволяет
посмотреть интерфейс, но не предоставляет API: без приложения панель
показывает OFFLINE и пустые метрики.

[Отчёт об обновлении и проверках](../docs/panel-update.md).

Модульная версия панели ServerGuard. Разметка, стили и логика
каждого раздела (SSH Key Guard, Security, Telegram Bot, SSH
Hardening, FileGuard) лежат в отдельной папке — можно менять один
модуль, не трогая остальные.

## Структура

```
index.html                — Dashboard, сайдбар, main и диалог
core/
  core.css                — общий дизайн (переменные, кнопки, статы, вкладки,
                             лог, диалог, .info-grid/.info-card)
  panel.css               — фиолетовая тема, Dashboard и адаптивность модулей
  dashboard.js            — GET health/stats, единый статус, ручное обновление
                             и очистка метрик при ошибках
  core.js                 — общая инфраструктура:
                               * api()            — очередь запросов к серверу
                               * setBusy/isBusy    — глобальный флаг "идёт операция"
                               * banner()          — баннер связи с сервером
                               * ask()             — диалог подтверждения
                               * createLogger()    — журнал действий модуля
                               * registerModule()  — регистрация модуля
                               * MODULE_MANIFEST   — список модулей и порядок вкладок
                               * загрузка modules/<id>/{index.html,style.css,script.js}
modules/
  sshkeys/    index.html, style.css, script.js
  security/   index.html, style.css, script.js
  telegram/   index.html, style.css, script.js
  hardening/  index.html, style.css, script.js
  fileguard/  index.html, style.css, script.js   (UI есть, backend не проверен)
```

## Как это работает

1. `index.html` загружает `core/core.css`, `core/panel.css`, данные карты,
   `core/core.js` и `core/dashboard.js`. Скрипты используют `defer`.
   После загрузки модулей событие `serverguard:ready` запускает GET-запросы
   Dashboard. Доступность модулей определяется прежним `/api/modules`.
2. `core.js` по списку `MODULE_MANIFEST` последовательно подгружает
   для каждого модуля его `style.css` (через `<link>`), `index.html`
   (вставляется в `#main`) и `script.js` (через `<script>`).
3. Каждый `script.js` модуля оборачивает себя в `(function(){...})()`,
   чтобы не засорять глобальную область видимости, и в конце
   регистрируется:

   ```js
   registerModule("telegram", {
       onShow:       refreshStatus,   // вызов при открытии вкладки
       onBusyChange: renderActions,   // перерисовать кнопки при смене busy
       initialLoad:  refreshStatus,   // один раз при старте, если модуль
                                       // включён на сервере (/api/modules)
       autoRefresh: {
           checkboxId: "telegramAuto",
           intervalMs: 15000,
           fn: refreshStatus
       }
   });
   ```

   Все поля необязательны — можно зарегистрировать модуль вообще без
   логики (см. `modules/fileguard/script.js`).

4. Общие компоненты (кнопки `.btn`, карточки статистики `.stat`,
   `.info-grid`/`.info-card`, вкладки `.tabs`, журнал `ul.log`, диалог)
   лежат в `core/core.css` — модулю не нужно их заново объявлять.
   В `style.css` модуля добавляются только уникальные для него классы
   (пример: `.hardening-grid`/`.hardening-item` у SSH Hardening,
   `.port-list`/`.port` у Security).

## Как добавить новый модуль

1. Создать папку `modules/<id>/` с тремя файлами:
   - `index.html` — `<section data-module="<id>" hidden>…</section>`
   - `style.css` — стили, специфичные только для этого модуля
     (можно оставить файл почти пустым, если хватает core.css)
   - `script.js` — логика в `(function(){...})()`, в конце
     `ServerGuard.registerModule("<id>", {...})`
2. Добавить одну строку в `MODULE_MANIFEST` в `core/core.js`.
3. Всё. `index.html` и остальные модули трогать не нужно — новый
   модуль подхватится автоматически при следующей загрузке страницы.

Важно: **id элементов внутри модуля должны быть уникальными в рамках
всего приложения** — все секции модулей одновременно живут в одном
DOM (просто скрыты через `hidden`), а `core.js` ищет элементы через
`document.getElementById`. Проще всего — префиксовать все id именем
модуля (`telegramSpin`, `telegramStats`, …), как это сделано в
`security`, `telegram` и `hardening`.

## Проверка frontend

```sh
node tests/panel-state.test.cjs
```

Команда запускается из корня репозитория. Это изолированные тесты
состояния с DOM/fetch-заглушками, а не браузерное тестирование
или проверка настоящего SSH-подключения. Зависимости не требуются.

Dashboard использует только существующие `/api/health`, `/api/modules`
и `/api/server/stats`, прежние поля и алиасы ответа. ONLINE означает, что
health и запрос данных успешно завершились и API вернул известные поля;
без исходников backend это не является независимым подтверждением
активной SSH-сессии или состояния защиты.
