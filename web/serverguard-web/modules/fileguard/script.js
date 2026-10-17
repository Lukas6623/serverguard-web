"use strict";

// ============================================================
// MODULE: FILEGUARD (заготовка)
//
// Реального API у этого модуля пока нет, поэтому регистрация
// минимальная — просто занимает место в навигации. Как только
// на сервере появятся ручки /api/fileguard/..., по образцу
// modules/security/script.js сюда добавляются:
//   - refreshStatus() / renderStats() / renderActions()
//   - registerModule("fileguard", { onShow, onBusyChange,
//                                    initialLoad, autoRefresh })
// ============================================================

(function ()
{

const { registerModule } = window.ServerGuard;

registerModule("fileguard", {
    // onShow / initialLoad не нужны, пока нет бэкенда —
    // раздел просто показывает статичную заглушку из index.html.
});

})();
