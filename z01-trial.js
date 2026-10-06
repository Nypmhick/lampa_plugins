/**
 * Z01 AUTO TRIAL — отдельный плагин.
 * Дёргает window.zpremTrial из основного плагина Z01 каждые 46 часов.
 * Не зависит от порядка загрузки: сам ждёт Lampa и window.zpremTrial.
 */
(function () {
  'use strict';

  var KEY = 'z01_last_reset_time';
  var INTERVAL = 46 * 60 * 60 * 1000; // 46 часов
  var RETRY_FAST = 30 * 1000;         // 30с — быстрый повтор при сетевой ошибке
  var CHECK_PERIOD = 30 * 60 * 1000;  // 30 мин — плановая проверка
  var running = false;
  var tick_timer = null;

  function log() {
    var args = ['[Z01-Trial]'].concat(Array.prototype.slice.call(arguments));
    if (window.console && console.log) console.log.apply(console, args);
  }

  function ready() {
    return typeof Lampa !== 'undefined' &&
           Lampa.Storage &&
           Lampa.Utils &&
           Lampa.Listener;
  }

  function refreshUI() {
    try {
      if (Lampa.Settings && Lampa.Settings.update) Lampa.Settings.update();
      var a = Lampa.Activity && Lampa.Activity.active();
      if (a && a.activity && typeof a.activity.start === 'function') a.activity.start();
    } catch (e) { /* silent */ }
  }

  function need() {
    var last = Lampa.Storage.get(KEY, 0);
    if (!Lampa.Storage.get('lampac_unic_id', '')) return true;
    if (!Lampa.Storage.get('account_email', '')) return true;
    if (!Lampa.Storage.get('zpremkey', '')) return true;
    if (!last || (Date.now() - last) > INTERVAL) return true;
    return false;
  }

  /**
   * Пробуем вызвать zpremTrial. Если его ещё нет — подождём.
   * Если сервер ответил сетевой ошибкой — вернём retry=true.
   */
  function callTrial(done) {
    var attempts = 20; // до 20 секунд ждём появления zpremTrial
    var tryOnce = function () {
      if (typeof window.zpremTrial === 'function') {
        try {
          window.zpremTrial(function (ok, reason) {
            done(ok, reason);
          });
        } catch (e) {
          log('zpremTrial выбросил исключение:', e);
          done(false, 'exception');
        }
        return;
      }
      attempts--;
      if (attempts <= 0) {
        done(false, 'no_zpremTrial');
        return;
      }
      setTimeout(tryOnce, 1000);
    };
    tryOnce();
  }

  function activate(reason) {
    if (running) return;
    running = true;
    log('Активация триала, причина:', reason || 'manual');

    var new_uid = Lampa.Utils.uid(12).toLowerCase();
    var new_email = 'auto_' + Lampa.Utils.uid(8).toLowerCase() + '@gmail.com';
    Lampa.Storage.set('lampac_unic_id', new_uid);
    Lampa.Storage.set('account_email', new_email);
    Lampa.Storage.set('zprem_trial_used', '');

    callTrial(function (ok, why) {
      running = false;

      if (ok) {
        log('Триал активирован, uid=', new_uid);
        Lampa.Storage.set(KEY, Date.now());
        // Сбросим kesh, чтобы UI подхватил новый ключ
        try { Lampa.Storage.set('z01_source_quality', {}); } catch (e) {}
        setTimeout(refreshUI, 500);
        setTimeout(refreshUI, 2500);
        return;
      }

      log('Не удалось активировать триал, reason=', why);

      // Сетевые ошибки — быстро повторить
      if (why === 'network_error' || why === 'exception' || why === 'no_zpremTrial') {
        setTimeout(function () {
          Lampa.Storage.set(KEY, 0);
          activate('retry:' + why);
        }, RETRY_FAST);
        return;
      }

      // already_used — тоже пробуем ещё раз с новым uid (как было в оригинале)
      if (why === 'already_used') {
        setTimeout(function () {
          Lampa.Storage.set(KEY, 0);
          activate('retry:already_used');
        }, 3000);
        return;
      }

      // Прочие ошибки (no_data, parse_error, blocked и т.д.) — повтор через 5 мин
      setTimeout(function () {
        Lampa.Storage.set(KEY, 0);
        activate('retry:' + why);
      }, 5 * 60 * 1000);
    });
  }

  function schedule() {
    if (need()) {
      setTimeout(function () { activate('startup'); }, 2000);
    } else {
      var last = Lampa.Storage.get(KEY, 0);
      var left = Math.round((INTERVAL - (Date.now() - last)) / 3600000);
      log('Триал активен, осталось примерно', left, 'ч');
    }
  }

  function start() {
    if (!ready()) {
      setTimeout(start, 500);
      return;
    }
    log('Инициализация');

    if (window.appready) schedule();
    else Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') schedule();
    });

    if (tick_timer) clearInterval(tick_timer);
    tick_timer = setInterval(function () {
      if (need()) {
        Lampa.Storage.set(KEY, 0);
        activate('periodic');
      }
    }, CHECK_PERIOD);
  }

  start();
})();
