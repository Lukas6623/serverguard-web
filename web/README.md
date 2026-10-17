# ServerGuard — веб-интерфейс

Модульная версия панели ServerGuard. Разметка, стили и логика
каждого раздела (SSH Key Guard, Security, Telegram Bot, SSH
Hardening, FileGuard) лежат в отдельной папке — можно менять один
модуль, не трогая остальные.

## Структура

```
index.html                — только каркас страницы (сайдбар, main, диалог)
core/
  core.css                — общий дизайн (переменные, кнопки, статы, вкладки,
                             лог, диалог, .info-grid/.info-card)
  core.js                 — вся общая инфраструктура:
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
  fileguard/  index.html, style.css, script.js   (заготовка — бэкенда ещё нет)
```

## Как это работает

1. `index.html` грузит только `core/core.css` и `core/core.js`.
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
