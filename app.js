/* ==========================================================================
   EcoSpark Team - checklist and timer for cleaners
   ==========================================================================
   One flat script, no build step, no framework: GitHub Pages serves the files
   as they are. Plain <script> rather than a module, so the page also opens from
   a local file when the checklist is inlined for testing.

   Two rules run through the whole file:

   1. TIME IS DERIVED, NEVER ACCUMULATED. Every duration is computed from
      stored Date.now() marks. The interval below only repaints; a phone that
      locks, sleeps or unloads the tab for two hours loses nothing, whereas a
      counter incremented each tick would lose exactly those two hours.

   2. STATE IS WRITTEN ON EVERY CHANGE. save() runs after every mutation, so a
      reload lands on the same screen with the same ticks. Nothing lives only
      in a variable.
   ========================================================================== */

/* The n8n webhook. It is visible in public source, and that is fine: the token
   check inside n8n is what provides the security, not this URL.
   The path `ecospark-team` must exist as a Webhook node in n8n (POST). Enable
   "Allowed Origins (CORS)" = * in that node's options, otherwise the browser
   blocks the response and every event sits in the retry queue forever. */
var WEBHOOK_URL = 'https://wara1561.app.n8n.cloud/webhook/ecospark-team';

var LS_STATE = 'ecospark.team.state.v1';
var LS_QUEUE = 'ecospark.team.queue.v1';   /* kept apart from the state on purpose:
                                              a corrupt state must never take
                                              unsent reports down with it */
var QUEUE_CAP = 300;                       /* a phone that is offline for weeks
                                              should not fill localStorage */
var RETRY_MS = 30000;

/* --------------------------------------------------------------------------
   Interface dictionary. Checklist texts are NOT here - they come from
   checklist.json, which is the single source of truth for them.
   -------------------------------------------------------------------------- */

var T = {
  ru: {
    gate: 'Откройте свою личную ссылку от EcoSpark.',
    addressEyebrow: 'Новая уборка',
    hello: 'Привет, {name}',
    helloNoName: 'Привет',
    addressSub: 'Введите эйркод и нажмите Старт. Таймер пойдёт сразу.',
    addressLabel: 'Эйркод',
    addressPh: 'D02 AF30',
    addressHint: 'Если эйркода нет - напишите адрес',
    addressEmpty: 'Введите эйркод',
    recentTitle: 'Недавние',
    start: 'Старт',
    typeTitle: 'Какая уборка?',
    clockLabel: 'Работа',
    breakStart: 'Перерыв',
    breakEnd: 'Продолжить',
    breakNow: 'Перерыв · {time}',
    finish: 'Финиш',
    changeType: 'Сменить тип',
    legendTitle: 'Средства: что чем',
    stepsEnd: 'Комната готова. Переходите на следующую вкладку.',
    plainTitle: 'Чек-лист не выбран',
    plainBody: 'Таймер идёт. Нажмите Финиш, когда закончите.',
    infoWith: 'Чем',
    infoCheck: 'Проверка',
    askFinishTitle: 'Завершить уборку?',
    askFinishBody: 'Таймер остановится, и отчёт уйдёт Ивану.',
    askYes: 'Да, завершить',
    askNo: 'Нет, продолжить',
    doneTitle: 'Готово',
    doneType: 'Тип уборки',
    doneWork: 'Время работы',
    doneBreak: 'Перерывы',
    doneTotal: 'Всего на объекте',
    doneChecklist: 'Чек-лист',
    doneNoChecklist: 'не выбран',
    doneBreaksNone: 'нет',
    newRun: 'Новая уборка',
    pending: 'Не отправлено, отправим позже',
    noType: 'Продолжить без выбора',
    loadFail: 'Не удалось загрузить чек-лист. Проверьте связь и обновите страницу.',
    infoBtn: 'Подробнее',
    hm: '{h} ч {m} мин',
    mOnly: '{m} мин',
    breaksCount: '{m} мин ({n})',
    /* three forms, because "61 пунктов" on a card reads as a typo and makes
       the number itself look careless - same reason the main site grew a
       plural() helper for the n8n report */
    stepsCount: ['{n} пункт', '{n} пункта', '{n} пунктов']
  },
  en: {
    gate: 'Please open your personal EcoSpark link.',
    addressEyebrow: 'New clean',
    hello: 'Hi, {name}',
    helloNoName: 'Hi',
    addressSub: 'Enter the Eircode and press Start. The timer begins right away.',
    addressLabel: 'Eircode',
    addressPh: 'D02 AF30',
    addressHint: 'No Eircode? Write the address instead',
    addressEmpty: 'Enter the Eircode',
    recentTitle: 'Recent',
    start: 'Start',
    typeTitle: 'Which clean?',
    clockLabel: 'Work',
    breakStart: 'Break',
    breakEnd: 'Resume',
    breakNow: 'Break · {time}',
    finish: 'Finish',
    changeType: 'Change type',
    legendTitle: 'Products: what goes where',
    stepsEnd: 'Room done. Move on to the next tab.',
    plainTitle: 'No checklist selected',
    plainBody: 'The timer is running. Press Finish when you are done.',
    infoWith: 'With',
    infoCheck: 'Check',
    askFinishTitle: 'Finish the clean?',
    askFinishBody: 'The timer stops and the report goes to Ivan.',
    askYes: 'Yes, finish',
    askNo: 'No, carry on',
    doneTitle: 'All done',
    doneType: 'Type of clean',
    doneWork: 'Working time',
    doneBreak: 'Breaks',
    doneTotal: 'Total on site',
    doneChecklist: 'Checklist',
    doneNoChecklist: 'not selected',
    doneBreaksNone: 'none',
    newRun: 'New clean',
    pending: 'Not sent yet, we will send it later',
    noType: 'Continue without type',
    loadFail: 'Could not load the checklist. Check your connection and reload.',
    infoBtn: 'Details',
    hm: '{h} h {m} min',
    mOnly: '{m} min',
    breaksCount: '{m} min ({n})',
    stepsCount: ['{n} step', '{n} steps', '{n} steps']
  }
};

function t(key, vars){
  var s = (T[state.lang] && T[state.lang][key]) || T.ru[key] || key;
  if (vars) for (var k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

/* Plural form for a count. Russian needs three; English uses the first for 1
   and the second otherwise, which the pairs above already encode. */
function plural(key, n){
  var forms = (T[state.lang] && T[state.lang][key]) || T.ru[key];
  var i;
  if (state.lang === 'ru') {
    if (n % 10 === 1 && n % 100 !== 11) i = 0;
    else if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) i = 1;
    else i = 2;
  } else {
    i = n === 1 ? 0 : 1;
  }
  return forms[i].split('{n}').join(n);
}

/* --------------------------------------------------------------------------
   Storage. Every access is wrapped: Safari in private mode throws on write,
   and a cleaner must never see a crash because of it.
   -------------------------------------------------------------------------- */

function lsGet(key){
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function lsSet(key, value){
  try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
}
function readJSON(key, fallback){
  var raw = lsGet(key);
  if (!raw) return fallback;
  try { var v = JSON.parse(raw); return v == null ? fallback : v; } catch (e) { return fallback; }
}

function uuid(){
  try {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    if (window.crypto && window.crypto.getRandomValues) {
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      var h = [], i;
      for (i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
      return h.slice(0,4).join('') + '-' + h.slice(4,6).join('') + '-' +
             h.slice(6,8).join('') + '-' + h.slice(8,10).join('') + '-' + h.slice(10).join('');
    }
  } catch (e) {}
  /* Last resort on an ancient browser. Only has to be unique per phone, since
     n8n de-duplicates per event_id and these carry a timestamp. */
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* --------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */

var state = {
  v: 1,
  token: '',
  name: '',
  lang: 'ru',
  addresses: [],
  session: null
};

/* session = { id, address, type, startedAt, finishedAt, breaks:[{start,end}],
               done:{ "room/step":true }, tab } */

var data = null;          /* checklist.json */
var openStep = null;      /* which ⓘ is expanded - view state, not progress */
var ticker = null;
var flushing = false;

function save(){
  lsSet(LS_STATE, JSON.stringify(state));
}

/* --------------------------------------------------------------------------
   Time
   -------------------------------------------------------------------------- */

function breakMs(s, now){
  var total = 0;
  for (var i = 0; i < s.breaks.length; i++) {
    var b = s.breaks[i];
    total += (b.end == null ? now : b.end) - b.start;
  }
  return total > 0 ? total : 0;
}
function openBreak(s){
  var last = s.breaks[s.breaks.length - 1];
  return last && last.end == null ? last : null;
}
function totalMs(s, now){
  return (s.finishedAt == null ? now : s.finishedAt) - s.startedAt;
}
function workMs(s, now){
  var v = totalMs(s, now) - breakMs(s, now);
  return v > 0 ? v : 0;
}

function clockStr(ms){
  var sec = Math.floor(ms / 1000);
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
  return h > 0 ? h + ':' + mm + ':' + ss : m + ':' + ss;
}
function minsStr(min){
  if (min < 60) return t('mOnly', { m: min });
  return t('hm', { h: Math.floor(min / 60), m: pad2(min % 60) });
}
function pad2(n){ return (n < 10 ? '0' : '') + n; }

/* --------------------------------------------------------------------------
   Checklist text rules (see _textRules in checklist.json)

   s -> text.s || text.all
   d -> text.d || text.all
   r -> text.r || text.all || text.d
   No text for the type, or excludeIn contains it -> the step is hidden.
   -------------------------------------------------------------------------- */

function stepText(step, type){
  if (!step || !step.text) return null;
  if (step.excludeIn && step.excludeIn.indexOf(type) !== -1) return null;
  var x = step.text, pick = null;
  if (type === 's') pick = x.s || x.all;
  else if (type === 'd') pick = x.d || x.all;
  else if (type === 'r') pick = x.r || x.all || x.d;
  if (!pick) return null;
  return pick[state.lang] || pick.ru || null;
}
function loc(obj){
  if (!obj) return '';
  return obj[state.lang] || obj.ru || '';
}

function roomSteps(roomId, type){
  var room = null, out = [];
  for (var i = 0; i < data.rooms.length; i++) if (data.rooms[i].id === roomId) room = data.rooms[i];
  if (!room) return out;
  for (var j = 0; j < room.steps.length; j++) {
    var id = room.steps[j], step = data.steps[id];
    var text = stepText(step, type);
    if (text) out.push({ id: id, step: step, text: text });
  }
  return out;
}

function roomTally(roomId, type, done){
  var list = roomSteps(roomId, type), n = 0;
  for (var i = 0; i < list.length; i++) if (done[roomId + '/' + list[i].id]) n++;
  return { done: n, total: list.length };
}
function allTally(type, done){
  var total = 0, n = 0, rooms = [];
  for (var i = 0; i < data.rooms.length; i++) {
    var r = data.rooms[i], tl = roomTally(r.id, type, done);
    rooms.push({ room: r.id, done: tl.done, total: tl.total });
    n += tl.done; total += tl.total;
  }
  return { done: n, total: total, rooms: rooms };
}

function typeById(id){
  for (var i = 0; i < data.types.length; i++) if (data.types[i].id === id) return data.types[i];
  return null;
}
function typeKey(id){
  var ty = typeById(id);
  return ty ? ty.key : 'none';
}
function typeName(id){
  var ty = typeById(id);
  return ty ? loc(ty.name) : loc(data.noTypeOption.name);
}

/* --------------------------------------------------------------------------
   Events and the offline queue

   An event leaves the queue only on a 2xx. Everything else - a 404, a 500, a
   dead network, a CORS rejection - keeps it, and a retry fires on `online`, on
   page open and every 30 seconds.
   -------------------------------------------------------------------------- */

function queueRead(){ var q = readJSON(LS_QUEUE, []); return Array.isArray(q) ? q : []; }
function queueWrite(q){
  if (q.length > QUEUE_CAP) q = q.slice(q.length - QUEUE_CAP);
  lsSet(LS_QUEUE, JSON.stringify(q));
  paintPending(q.length);
}

function emit(name, extra){
  var s = state.session;
  var ev = {
    event: name,
    event_id: uuid(),
    session_id: s ? s.id : null,
    token: state.token,
    name: state.name,
    address: s ? s.address : '',
    timestamp: new Date().toISOString(),
    lang: state.lang
  };
  if (extra) for (var k in extra) ev[k] = extra[k];
  var q = queueRead();
  q.push(ev);
  queueWrite(q);
  flush();
}

function flush(){
  if (flushing) return;
  var q = queueRead();
  if (!q.length) return;
  flushing = true;

  /* Strictly in order and one at a time: the start must reach Telegram before
     the finish, and the first failure stops the run so a dead network does not
     produce a burst of pointless requests. */
  var step = function(){
    var queue = queueRead();
    if (!queue.length) { flushing = false; return; }
    var ev = queue[0];
    send(ev).then(function(ok){
      if (!ok) { flushing = false; return; }
      var now = queueRead();
      /* re-read: a click may have appended while the request was in flight */
      if (now.length && now[0].event_id === ev.event_id) now.shift();
      queueWrite(now);
      step();
    });
  };
  step();
}

function send(ev){
  if (!window.fetch) return Promise.resolve(false);
  return fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ev),
    /* so a finish sent as the phone is being pocketed still goes out */
    keepalive: true
  }).then(function(r){
    return r.status >= 200 && r.status < 300;
  }).catch(function(){
    return false;
  });
}

function paintPending(n){
  var box = document.getElementById('pending');
  if (n > 0) {
    document.getElementById('pendingText').textContent = t('pending');
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

/* --------------------------------------------------------------------------
   Screens
   -------------------------------------------------------------------------- */

var SCREENS = ['scrGate', 'scrAddress', 'scrType', 'scrWork', 'scrDone'];

function show(id){
  for (var i = 0; i < SCREENS.length; i++) {
    document.getElementById(SCREENS[i]).hidden = (SCREENS[i] !== id);
  }
}

function currentScreen(){
  if (!state.token) return 'scrGate';
  var s = state.session;
  if (!s) return 'scrAddress';
  if (s.finishedAt) return 'scrDone';
  if (s.type == null) return 'scrType';
  return 'scrWork';
}

function render(){
  applyStatic();
  var scr = currentScreen();
  show(scr);
  if (scr === 'scrAddress') renderAddress();
  if (scr === 'scrType') renderTypes();
  if (scr === 'scrWork') renderWork();
  if (scr === 'scrDone') renderDone();
  tick();
  if (scr === 'scrType' || scr === 'scrWork') startTicker(); else stopTicker();
}

/* Everything marked data-t / data-t-ph in the HTML, so the language switch is
   one pass instead of twenty assignments. */
function applyStatic(){
  document.documentElement.lang = state.lang;
  var nodes = document.querySelectorAll('[data-t]'), i;
  for (i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-t'));
  nodes = document.querySelectorAll('[data-t-ph]');
  for (i = 0; i < nodes.length; i++) nodes[i].placeholder = t(nodes[i].getAttribute('data-t-ph'));
  var btns = document.querySelectorAll('.lang button');
  for (i = 0; i < btns.length; i++) {
    btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-lang') === state.lang ? 'true' : 'false');
  }
  paintPending(queueRead().length);
}

function esc(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---- address ---- */

/* Возврат строки под полем в обычное состояние: снова подсказка, не ошибка. */
function clearAddrError(){
  document.getElementById('addrField').classList.remove('is-bad');
  document.getElementById('addrNote').textContent = t('addressHint');
}

function renderAddress(){
  document.getElementById('hello').textContent =
    state.name ? t('hello', { name: state.name }) : t('helloNoName');

  var box = document.getElementById('recent'), list = document.getElementById('recentList');
  var addrs = state.addresses.slice(0, 5);
  box.hidden = addrs.length === 0;
  var html = '';
  for (var i = 0; i < addrs.length; i++) {
    html += '<button type="button" class="recent__item" data-addr="' + esc(addrs[i]) + '">' +
            '<svg aria-hidden="true"><use href="#i-pin"/></svg><span>' + esc(addrs[i]) + '</span></button>';
  }
  list.innerHTML = html;
}

/* ---- type ---- */

function renderTypes(){
  document.getElementById('typeAddr').textContent = state.session.address;
  var host = document.getElementById('typeList'), html = '', i;
  for (i = 0; i < data.types.length; i++) {
    var ty = data.types[i];
    var counts = countsFor(ty.id);
    html += '<button type="button" class="type-btn" data-type="' + esc(ty.id) + '">' +
              '<span class="type-btn__mark">' + esc(loc(ty.name).charAt(0)) + '</span>' +
              '<span class="type-btn__body">' +
                '<span class="type-btn__name">' + esc(loc(ty.name)) + '</span>' +
                '<span class="type-btn__meta">' + counts + '</span>' +
              '</span>' +
            '</button>';
  }
  html += '<button type="button" class="type-btn type-btn--plain" data-type="none">' +
            '<span class="type-btn__mark">&times;</span>' +
            '<span class="type-btn__body">' +
              '<span class="type-btn__name">' + esc(loc(data.noTypeOption.name)) + '</span>' +
              '<span class="type-btn__meta">' + esc(t('plainBody')) + '</span>' +
            '</span>' +
          '</button>';
  host.innerHTML = html;
}

function countsFor(typeId){
  return esc(plural('stepsCount', allTally(typeId, {}).total));
}

/* ---- work ---- */

function renderWork(){
  var s = state.session;
  document.getElementById('workAddr').textContent = s.address;
  document.getElementById('workType').textContent = typeName(s.type);

  paintChangeType();

  var hasList = s.type !== 'none';
  document.getElementById('checklistHost').hidden = !hasList;
  document.getElementById('plainNote').hidden = hasList;
  document.getElementById('progressWrap').hidden = !hasList;

  if (hasList) {
    renderLegend();
    renderTabs();
    renderSteps();
  }
  paintBreakUI();
}

function renderLegend(){
  var ul = document.getElementById('legendList'), html = '';
  for (var i = 0; i < data.legend.length; i++) html += '<li>' + esc(loc(data.legend[i])) + '</li>';
  ul.innerHTML = html;
}

function renderTabs(){
  var s = state.session, host = document.getElementById('tabs'), html = '';
  for (var i = 0; i < data.rooms.length; i++) {
    var r = data.rooms[i], tl = roomTally(r.id, s.type, s.done);
    var on = r.id === s.tab;
    var full = tl.total > 0 && tl.done === tl.total;
    html += '<button type="button" role="tab" class="tab' + (full ? ' is-full' : '') + '"' +
            ' data-tab="' + esc(r.id) + '" aria-controls="stepsPanel"' +
            ' aria-selected="' + (on ? 'true' : 'false') + '">' +
            esc(loc(r.name)) +
            '<span class="tab__count">' + tl.done + '/' + tl.total + '</span></button>';
  }
  host.innerHTML = html;
  centerTab();
}

/* Centre the active tab in the strip by moving the strip's OWN scrollLeft.
   scrollIntoView would do this too, but it scrolls every scrollable ancestor,
   the document included - which is what threw the page back to the top on
   every tick, since the tab row lives near the top. Measured: 658 -> 224. */
function centerTab(){
  var host = document.getElementById('tabs');
  var active = host.querySelector('[aria-selected="true"]');
  if (!active) return;
  host.scrollLeft = Math.max(0, active.offsetLeft - (host.clientWidth - active.offsetWidth) / 2);
}

/* ---- targeted repaints ----
   A tick changes exactly one row, one counter and one bar. Rebuilding the
   whole <ol> for that also threw the page: replacing innerHTML collapses the
   document for an instant and the browser clamps the scroll position to the
   shorter page. These three touch only what actually changed. */

function paintStep(key){
  var li = document.getElementById('step-' + key);
  if (!li) return;
  var done = !!state.session.done[key];
  li.classList.toggle('is-done', done);
  var btn = li.querySelector('[data-tick]');
  if (btn) btn.setAttribute('aria-pressed', done ? 'true' : 'false');
  var num = li.querySelector('.step__num');
  if (num) num.innerHTML = done ? '<svg><use href="#i-check"/></svg>' : li.getAttribute('data-n');
}

function paintTabCounts(){
  var s = state.session;
  for (var i = 0; i < data.rooms.length; i++) {
    var r = data.rooms[i], tl = roomTally(r.id, s.type, s.done);
    var tab = document.querySelector('[data-tab="' + r.id + '"]');
    if (!tab) continue;
    tab.querySelector('.tab__count').textContent = tl.done + '/' + tl.total;
    tab.classList.toggle('is-full', tl.total > 0 && tl.done === tl.total);
  }
}

function paintProgress(){
  var tl = allTally(state.session.type, state.session.done);
  document.getElementById('progressFill').style.width =
    (tl.total ? Math.round(tl.done / tl.total * 100) : 0) + '%';
}

/* The type can be swapped only while nothing is ticked: changing the list
   under finished work would drop ticks silently. */
function paintChangeType(){
  var s = state.session, ticked = 0;
  for (var k in s.done) if (s.done[k]) ticked++;
  document.getElementById('changeType').hidden = !(s.type !== 'none' && ticked === 0);
}

/* Only one ⓘ is open at a time, so this shows openStep and hides the rest
   without touching the list markup. */
function paintDetails(){
  var panes = document.querySelectorAll('.step__detail'), i;
  for (i = 0; i < panes.length; i++) panes[i].hidden = (panes[i].id.slice(2) !== openStep);
  var btns = document.querySelectorAll('[data-info]');
  for (i = 0; i < btns.length; i++) {
    btns[i].setAttribute('aria-expanded', btns[i].getAttribute('data-info') === openStep ? 'true' : 'false');
  }
}

function renderSteps(){
  var s = state.session;
  var list = roomSteps(s.tab, s.type), html = '';
  for (var i = 0; i < list.length; i++) {
    var it = list[i], key = s.tab + '/' + it.id, isDone = !!s.done[key];
    var isOpen = openStep === key;
    var info = loc(it.step.info), check = loc(it.step.check);
    var warn = it.step.warn && data.warnings[it.step.warn] ? loc(data.warnings[it.step.warn]) : '';

    /* data-n keeps the row's number available after a tick has replaced it
       with the checkmark, so paintStep can put it back without a rebuild */
    html += '<li class="step' + (isDone ? ' is-done' : '') + '" id="step-' + esc(key) + '"' +
            ' data-n="' + (i + 1) + '">' +
      '<div class="step__row">' +
        '<button type="button" class="step__tick" data-tick="' + esc(key) + '"' +
                ' aria-pressed="' + (isDone ? 'true' : 'false') + '">' +
          '<span class="step__num" aria-hidden="true">' +
            (isDone ? '<svg><use href="#i-check"/></svg>' : (i + 1)) +
          '</span>' +
          '<span class="step__text">' + esc(it.text) + '</span>' +
        '</button>' +
        '<button type="button" class="step__info" data-info="' + esc(key) + '"' +
                ' aria-expanded="' + (isOpen ? 'true' : 'false') + '"' +
                ' aria-controls="d-' + esc(key) + '" aria-label="' + esc(t('infoBtn')) + '">' +
          '<svg aria-hidden="true"><use href="#i-info"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="step__detail" id="d-' + esc(key) + '"' + (isOpen ? '' : ' hidden') + '>' +
        '<dl>' +
          (info  ? '<div><dt>' + esc(t('infoWith'))  + '</dt><dd>' + esc(info)  + '</dd></div>' : '') +
          (check ? '<div><dt>' + esc(t('infoCheck')) + '</dt><dd>' + esc(check) + '</dd></div>' : '') +
        '</dl>' +
        (warn ? '<p class="step__warn"><svg aria-hidden="true"><use href="#i-warn"/></svg>' +
                '<span>' + esc(warn) + '</span></p>' : '') +
      '</div>' +
    '</li>';
  }
  document.getElementById('steps').innerHTML = html;
  paintProgress();
}

function paintBreakUI(){
  var s = state.session;
  var on = !!openBreak(s);
  document.getElementById('breakBtn').textContent = on ? t('breakEnd') : t('breakStart');
  document.getElementById('breakBtn').className = 'btn ' + (on ? 'btn--gold' : 'btn--ghost');
  document.getElementById('breakBar').hidden = !on;
  document.getElementById('workClock').classList.toggle('is-paused', on);
}

/* ---- done ---- */

function renderDone(){
  var s = state.session;
  document.getElementById('doneAddr').textContent = s.address;
  var r = report(s);

  var rows = [
    ['doneWork',  minsStr(r.work_minutes), true],
    ['doneBreak', r.breaks_count ? t('breaksCount', { m: r.break_minutes, n: r.breaks_count }) : t('doneBreaksNone'), false],
    ['doneTotal', minsStr(r.total_minutes), false],
    ['doneType',  typeName(s.type), false],
    ['doneChecklist', r.checklist ? (r.checklist.done + '/' + r.checklist.total) : t('doneNoChecklist'), false]
  ];
  var html = '', i;
  for (i = 0; i < rows.length; i++) {
    html += '<div class="summary__row' + (rows[i][2] ? ' summary__row--head' : '') + '">' +
              '<span class="summary__k">' + esc(t(rows[i][0])) + '</span>' +
              '<span class="summary__v">' + esc(rows[i][1]) + '</span></div>';
  }
  document.getElementById('doneSummary').innerHTML = html;

  var ul = document.getElementById('doneRooms');
  if (!r.checklist) { ul.innerHTML = ''; return; }
  html = '';
  for (i = 0; i < r.checklist.rooms.length; i++) {
    var row = r.checklist.rooms[i], name = '';
    for (var j = 0; j < data.rooms.length; j++) if (data.rooms[j].id === row.room) name = loc(data.rooms[j].name);
    var cls = row.total && row.done === row.total ? 'is-full' : (row.done ? 'is-part' : '');
    html += '<li class="' + cls + '"><span>' + esc(name) + '</span><b>' + row.done + '/' + row.total + '</b></li>';
  }
  ul.innerHTML = html;
}

/* The numbers that go to n8n and the numbers on the screen come from this one
   function, so the cleaner and Ivan can never read different totals.
   work_minutes is total minus break rather than its own rounding of workMs:
   the Telegram message shows all three, and they have to add up. */
function report(s){
  var now = Date.now();
  var total = Math.round(totalMs(s, now) / 60000);
  var br = Math.round(breakMs(s, now) / 60000);
  var out = {
    type: typeKey(s.type),
    started_at: new Date(s.startedAt).toISOString(),
    finished_at: new Date(s.finishedAt == null ? now : s.finishedAt).toISOString(),
    total_minutes: total,
    break_minutes: br,
    breaks_count: s.breaks.length,
    work_minutes: total - br,
    checklist: null
  };
  if (s.type !== 'none') out.checklist = allTally(s.type, s.done);
  return out;
}

/* --------------------------------------------------------------------------
   Ticking clocks
   -------------------------------------------------------------------------- */

function startTicker(){
  if (ticker) return;
  ticker = window.setInterval(tick, 1000);
}
function stopTicker(){
  if (!ticker) return;
  window.clearInterval(ticker);
  ticker = null;
}

function tick(){
  var s = state.session;
  if (!s || s.finishedAt) return;
  var now = Date.now();
  var work = clockStr(workMs(s, now));
  var el = document.getElementById('workTime');
  if (el) el.textContent = work;
  var head = document.getElementById('typeClock');
  if (head) head.textContent = t('clockLabel') + ' · ' + work;
  var ob = openBreak(s);
  if (ob) document.getElementById('breakText').textContent =
    t('breakNow', { time: clockStr(now - ob.start) });
}

/* --------------------------------------------------------------------------
   Actions
   -------------------------------------------------------------------------- */

function startSession(address){
  state.session = {
    id: uuid(),
    address: address,
    type: null,
    startedAt: Date.now(),
    finishedAt: null,
    breaks: [],
    done: {},
    tab: data.rooms[0].id
  };
  rememberAddress(address);
  save();
  emit('start');
  render();
}

/* Эйркод набирают на телефоне как попало: "d02af30", "d02 af30", "D02-AF30".
   Приводим к одному виду, иначе один и тот же адрес ляжет в историю тремя
   разными строками и в отчёте Ивану будет выглядеть как три разных объекта.

   Формат: routing key (буква + 2 цифры) + 4 знака. Ровно 7 букв и цифр -
   считаем эйркодом и ставим пробел посередине. Всё остальное оставляем как
   есть: это адрес, который написали руками.

   Проверку формата здесь намеренно НЕ делаем. У новостроек эйркода может не
   быть вовсе, у квартир он бывает общий на весь дом, и валидатор, который не
   пускает дальше, остановит клинера прямо на пороге. */
function normAddress(value){
  var v = value.trim().replace(/\s+/g, ' ');
  var bare = v.replace(/[\s-]/g, '').toUpperCase();
  if (/^[A-Z][0-9]{2}[A-Z0-9]{4}$/.test(bare)) return bare.slice(0, 3) + ' ' + bare.slice(3);
  return v;
}

function rememberAddress(address){
  var low = address.toLowerCase(), out = [address];
  for (var i = 0; i < state.addresses.length; i++) {
    if (state.addresses[i].toLowerCase() !== low) out.push(state.addresses[i]);
  }
  state.addresses = out.slice(0, 5);
}

function chooseType(typeId){
  state.session.type = typeId;
  state.session.done = {};
  openStep = null;
  save();
  emit('type_selected', { type: typeKey(typeId) });
  render();
}

function toggleBreak(){
  var s = state.session, ob = openBreak(s);
  if (ob) { ob.end = Date.now(); save(); emit('break_end'); }
  else { s.breaks.push({ start: Date.now(), end: null }); save(); emit('break_start'); }
  paintBreakUI();
  tick();
}

function finishSession(){
  var s = state.session;
  var ob = openBreak(s);
  if (ob) { ob.end = Date.now(); save(); emit('break_end'); }
  s.finishedAt = Date.now();
  save();
  emit('finish', report(s));
  render();
}

function newRun(){
  state.session = null;   /* the address history is kept, per the brief */
  openStep = null;
  save();
  /* Чистим именно здесь, а не в renderAddress: тот вызывается и при смене
     языка, и тогда он стирал бы наполовину набранный эйркод. */
  var input = document.getElementById('addrInput');
  if (input) input.value = '';
  clearAddrError();
  render();
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */

function wire(){
  /* language */
  document.querySelector('.lang').addEventListener('click', function(e){
    var b = e.target.closest('[data-lang]');
    if (!b) return;
    state.lang = b.getAttribute('data-lang');
    save();
    render();
  });

  /* address */
  document.getElementById('addressForm').addEventListener('submit', function(e){
    e.preventDefault();
    var input = document.getElementById('addrInput');
    var value = normAddress(input.value);
    if (!value) {
      document.getElementById('addrField').classList.add('is-bad');
      document.getElementById('addrNote').textContent = t('addressEmpty');
      input.focus();
      return;
    }
    clearAddrError();
    startSession(value);
  });

  document.getElementById('addrInput').addEventListener('input', clearAddrError);

  document.getElementById('recentList').addEventListener('click', function(e){
    var b = e.target.closest('[data-addr]');
    if (!b) return;
    document.getElementById('addrInput').value = b.getAttribute('data-addr');
    clearAddrError();
  });

  /* type */
  document.getElementById('typeList').addEventListener('click', function(e){
    var b = e.target.closest('[data-type]');
    if (b) chooseType(b.getAttribute('data-type'));
  });

  document.getElementById('changeType').addEventListener('click', function(){
    state.session.type = null;
    state.session.done = {};
    openStep = null;
    save();
    render();   /* the timer is untouched: only the list is being re-picked */
  });

  /* work */
  document.getElementById('breakBtn').addEventListener('click', toggleBreak);

  document.getElementById('tabs').addEventListener('click', function(e){
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    state.session.tab = b.getAttribute('data-tab');
    openStep = null;
    save();
    renderTabs();
    renderSteps();
    window.scrollTo(0, 0);
  });

  document.getElementById('steps').addEventListener('click', function(e){
    var tickBtn = e.target.closest('[data-tick]');
    if (tickBtn) {
      var key = tickBtn.getAttribute('data-tick');
      var s = state.session;
      if (s.done[key]) delete s.done[key]; else s.done[key] = true;
      save();
      /* repaint only what changed - a full renderSteps()/renderTabs() here is
         what used to throw the page back to the top */
      paintStep(key);
      paintTabCounts();
      paintProgress();
      paintChangeType();
      return;
    }
    var infoBtn = e.target.closest('[data-info]');
    if (infoBtn) {
      var ik = infoBtn.getAttribute('data-info');
      openStep = (openStep === ik) ? null : ik;   /* only one open at a time */
      paintDetails();
      if (openStep) {
        var li = document.getElementById('step-' + openStep);
        if (li && li.scrollIntoView) {
          try { li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e2) {}
        }
      }
    }
  });

  /* finish, with a confirm so a pocket tap cannot end a job */
  document.getElementById('finishBtn').addEventListener('click', function(){
    var dlg = document.getElementById('askFinish');
    if (dlg.showModal) { dlg.showModal(); return; }
    /* iOS Safari below 15.4 has no <dialog> */
    if (window.confirm(t('askFinishTitle'))) finishSession();
  });
  document.getElementById('askYes').addEventListener('click', function(){
    document.getElementById('askFinish').close();
    finishSession();
  });
  document.getElementById('askNo').addEventListener('click', function(){
    document.getElementById('askFinish').close();
  });

  document.getElementById('newRun').addEventListener('click', newRun);

  /* queue retries */
  window.addEventListener('online', flush);
  window.setInterval(flush, RETRY_MS);
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) { flush(); tick(); }
  });

  /* The sticky bar's height feeds --bar-h, which the break banner sits below
     and which keeps a tapped step from parking under the bar. Measured rather
     than hard-coded: it changes with the language, a long address and the
     progress bar. */
  var bar = document.getElementById('workbar');
  var measure = function(){
    var h = bar.getBoundingClientRect().height;
    if (h) document.documentElement.style.setProperty('--bar-h', Math.round(h) + 'px');
  };
  if (window.ResizeObserver) new window.ResizeObserver(measure).observe(bar);
  window.addEventListener('resize', measure);
  measure();
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

function readIdentity(){
  var saved = readJSON(LS_STATE, null);
  if (saved && typeof saved === 'object') {
    state.token = saved.token || '';
    state.name = saved.name || '';
    state.lang = (saved.lang === 'en' ? 'en' : 'ru');
    state.addresses = Array.isArray(saved.addresses) ? saved.addresses.slice(0, 5) : [];
    state.session = saved.session || null;
  }

  var qs;
  try { qs = new URLSearchParams(window.location.search); } catch (e) { qs = null; }
  if (qs) {
    var c = (qs.get('c') || '').trim();
    var n = (qs.get('n') || '').trim();
    var lang = (qs.get('lang') || '').trim();
    if (c) state.token = c;
    if (n) state.name = n;
    if (lang === 'en' || lang === 'ru') state.lang = lang;
    if (c || n || lang) {
      save();
      /* Drop the token out of the address bar: it is the one secret on this
         page, and a screenshot of a session should not carry it. The link in
         the cleaner's messages still works - the token is already stored. */
      try { window.history.replaceState({}, '', window.location.pathname); } catch (e3) {}
    }
  }

  /* A session saved by an older version with no structure we understand is
     better dropped than half-read. */
  var s = state.session;
  if (s && (typeof s.startedAt !== 'number' || !Array.isArray(s.breaks) || !s.id)) {
    state.session = null;
  }
  if (state.session && !state.session.done) state.session.done = {};
}

function boot(){
  readIdentity();

  if (!state.token) {
    /* Nothing is fetched and nothing is rendered beyond the gate: without a
       token there is nothing for this page to do. */
    applyStatic();
    show('scrGate');
    return;
  }

  fetch('checklist.json', { cache: 'no-cache' })
    .then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(json){
      data = json;
      if (state.session && state.session.tab) {
        var ok = false;
        for (var i = 0; i < data.rooms.length; i++) if (data.rooms[i].id === state.session.tab) ok = true;
        if (!ok) state.session.tab = data.rooms[0].id;
      }
      wire();
      render();
      flush();   /* anything left from the last visit goes out now */
    })
    .catch(function(){
      applyStatic();
      show('scrGate');
      document.querySelector('#scrGate p').textContent = t('loadFail');
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
