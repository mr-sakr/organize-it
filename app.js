'use strict';

/* ===================== التخزين ===================== */
const STORE_KEY = 'organizeit.v1';
const VIEW_KEY = 'organizeit.view';

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.tasks) && Array.isArray(d.goals)) return migrate(d);
  } catch (e) { /* بيانات تالفة أو التخزين غير متاح */ }
  return { tasks: [], goals: [], events: [] };
}

// المهام القديمة كانت بالساعة فقط → تتحول لبداية ونهاية بالدقيقة
function migrate(d) {
  // events = عناصر التقويم الشهري/السنوي، منفصلة تمامًا عن مهام الجدول الأسبوعي
  if (!Array.isArray(d.events)) d.events = [];
  for (const t of [...d.tasks, ...d.events]) {
    if (t.start == null) {
      const h = Number(t.hour) || 0;
      t.start = h * 60;
      t.end = h * 60 + 60;
      delete t.hour;
    }
  }
  return d;
}

/* ----- التراجع -----
   قبل كل حفظ بنحتفظ بنسخة من البيانات اللي قبله (في الذاكرة بس، آخر 100 خطوة).
   فتح وطيّ الأهداف مش بيتحسب خطوة. */
const UNDO_LIMIT = 100;
const undoStack = [];
const contentKey = json => json.replace(/,?"collapsed":(true|false)/g, '');
let lastSaved = null;

function save() {
  const json = JSON.stringify(db);
  if (lastSaved !== null && contentKey(json) !== contentKey(lastSaved)) {
    undoStack.push(lastSaved);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  lastSaved = json;
  updateUndoBtn();
  try {
    localStorage.setItem(STORE_KEY, json);
  } catch (e) {
    alert(t('saveFailed'));
  }
}

function undo() {
  if (!undoStack.length) return;
  lastSaved = undoStack.pop();
  db = migrate(JSON.parse(lastSaved));
  try { localStorage.setItem(STORE_KEY, lastSaved); } catch (e) { alert(t('saveFailed')); }
  updateUndoBtn();
  renderAll();
}

function updateUndoBtn() {
  const btn = document.getElementById('undoBtn');
  if (btn) btn.disabled = !undoStack.length;
}

let db = load();
lastSaved = JSON.stringify(db);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ===================== التواريخ ===================== */
// backlog = الأهداف المعلّقة: ملهاش فترة لحد ما تتنقل لفترة معيّنة
// الأهداف اليومية اتلغت من العرض (لو فيه بيانات قديمة ليها بتفضل محفوظة زي ما هي)
const GOAL_TYPES = ['week', 'month', 'year', 'backlog'];
const MAX_KEY = 'organizeit.maxCard';

// منسّقات التاريخ بتتعمل من جديد مع كل تغيير لغة (الأرقام لاتيني في العربي)
let fmtDayMonth, fmtMonthYear, fmtFull, fmtMonth;
function setupFormatters() {
  const locale = lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  fmtDayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });
  fmtMonthYear = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  fmtFull = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  fmtMonth = new Intl.DateTimeFormat(locale, { month: 'long' });
}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
// الأسبوع يبدأ يوم السبت
const weekStart = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 1) % 7));

function hourLabel(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${h < 12 ? 'AM' : 'PM'}`;
}

// الوقت محفوظ كدقائق من بداية اليوم (0 – 1440)
function timeLabel(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
const toInputTime = min => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const fromInputTime = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const durationLabel = min => {
  const h = Math.floor(min / 60), m = min % 60;
  return [h && t('hourUnit', { n: h }), m && t('minUnit', { n: m })].filter(Boolean).join(' ');
};

function weekRangeLabel(start) {
  const end = addDays(start, 6);
  return `${fmtDayMonth.format(start)} – ${fmtDayMonth.format(end)} ${end.getFullYear()}`;
}

function periodKey(type, d) {
  switch (type) {
    case 'year': return String(d.getFullYear());
    case 'month': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    case 'week': return ymd(weekStart(d));
    case 'backlog': return '';
    default: return ymd(d);
  }
}

function periodLabel(type, d) {
  switch (type) {
    case 'year': return t('yearLabel', { y: d.getFullYear() });
    case 'month': return fmtMonthYear.format(d);
    case 'week': return weekRangeLabel(weekStart(d));
    case 'backlog': return t('backlogHint');
    default: return fmtFull.format(d);
  }
}

function shiftPeriod(type, d, dir) {
  switch (type) {
    case 'year': return new Date(d.getFullYear() + dir, d.getMonth(), 1);
    case 'month': return new Date(d.getFullYear(), d.getMonth() + dir, 1);
    case 'week': return addDays(d, 7 * dir);
    default: return addDays(d, dir);
  }
}

/* ===================== أدوات DOM ===================== */
const $ = s => document.querySelector(s);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ===================== التبويبات ===================== */
function setView(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  try { localStorage.setItem(VIEW_KEY, name); } catch (e) {}
  if (name === 'goals') markScrollingTrees(); // القياس محتاج التبويب يكون ظاهر
  if (name === 'week') applyZoom('week');
  if (name === 'calendar') applyZoom('month');
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));

/* ===================== الجدول الأسبوعي ===================== */
// كل يوم له صفّان، كل صف خط زمني مدته 12 ساعة (720 دقيقة):
// الصف الأول من 12:00 AM إلى 12:00 PM، والثاني من 12:00 PM إلى 12:00 AM.
const HALF = 720;
// الإضافة والسحب بتتقرّب لأقرب 15 دقيقة، ولأقرب 5 دقايق لما الزووم كبير (الساعة ≥ 300px)
const snapStep = () => (parseFloat($('#grid').style.getPropertyValue('--col-w')) || 0) >= 300 ? 5 : 15;
const LANE_H = 34;        // ارتفاع شريط المهمة
const LANE_GAP = 3;
const TRACK_MIN_H = 56;

let weekRef = weekStart(today());

/* ----- المهام المتكررة -----
   task.repeat = { days: [0..6], until: '' | 'YYYY-MM-DD' }  (0 = السبت)
   task.date هو تاريخ بداية التكرار
   task.skip = أيام اتشالت من التكرار، task.doneDates = أيام اتشطبت */
const dayIndex = key => (parseYmd(key).getDay() + 1) % 7;

function occursOn(task, key, idx) {
  if (!task.repeat) return task.date === key;
  return key >= task.date
    && (!task.repeat.until || key <= task.repeat.until)
    && task.repeat.days.includes(idx)
    && !(task.skip || []).includes(key);
}

const isOccDone = (task, key) => task.repeat ? (task.doneDates || []).includes(key) : !!task.done;

function setOccDone(task, key, done) {
  if (!task.repeat) { task.done = done; return; }
  const set = new Set(task.doneDates || []);
  done ? set.add(key) : set.delete(key);
  task.doneDates = [...set];
}

function repeatSummary(task) {
  const days = task.repeat.days;
  const names = days.length === 7 ? t('everyDay') : days.slice().sort().map(i => t('daysShort')[i]).join('، ');
  return t('repeatsOn', { days: lang === 'ar' ? names : names.replace(/،/g, ',') });
}

function renderWeek() {
  const grid = $('#grid');
  grid.innerHTML = '';
  $('#weekLabel').textContent = weekRangeLabel(weekRef);

  // ظهور كل مهمة في أيام الأسبوع (المتكررة بتظهر في كل يوم من أيامها)
  const byDate = new Map();
  let total = 0, done = 0;
  for (let i = 0; i < 7; i++) {
    const key = ymd(addDays(weekRef, i));
    const occ = db.tasks
      .filter(task => occursOn(task, key, i))
      .map(task => ({ t: task, date: key, done: isOccDone(task, key) }));
    total += occ.length;
    done += occ.filter(o => o.done).length;
    byDate.set(key, occ);
  }
  renderWeekProgress(done, total);
  requestAnimationFrame(() => applyZoom('week'));

  // رأس الساعات
  grid.append(el('div', 'corner', '#'));
  for (let h = 0; h < 12; h++) {
    const c = el('div', 'hhead');
    c.append(hourHead(h), hourHead(h + 12), minuteRuler());
    grid.append(c);
  }

  const todayKey = ymd(today());
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekRef, i);
    const key = ymd(date);
    const isToday = key === todayKey;

    const label = el('div', 'daylabel' + (isToday ? ' today' : ''));
    label.append(el('span', 'dname', t('days')[i]), el('span', 'ddate', fmtDayMonth.format(date)));
    const occ = byDate.get(key);
    if (occ.length) label.append(progressRing(occ.filter(o => o.done).length, occ.length));
    grid.append(label);

    for (let half = 0; half < 2; half++) {
      grid.append(buildTrack(key, half, occ, i === 0, isToday ? nowMin : null));
    }
  }
}

// ----- نسب الإنجاز -----
const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0);

// شريط إنجاز (الأسبوع / الشهر / السنة) في شريط الأدوات
function renderWeekProgress(done, total) { renderProgress($('#weekStats'), done, total, 'weekProgress'); }

function renderProgress(box, done, total, labelKey) {
  box.innerHTML = '';
  if (!total) return;
  const p = pct(done, total);
  const track = el('span', 'wk-track');
  const fill = el('span', 'wk-fill' + (p === 100 ? ' full' : ''));
  fill.style.width = `${p}%`;
  track.append(fill);
  box.title = t('weekStats', { done, total });
  box.append(el('span', 'wk-label', t(labelKey)), track, el('strong', 'wk-pct', `${p}%`), el('span', 'muted', `(${done}/${total})`));
}

// دايرة إنجاز اليوم تحت اسمه
function progressRing(done, total) {
  const p = pct(done, total);
  const ring = el('span', 'ring' + (p === 100 ? ' full' : ''));
  ring.style.setProperty('--p', p);
  ring.title = t('weekStats', { done, total });
  ring.append(el('span', null, `${p}%`));
  return ring;
}

// مسطرة الدقايق: 15/30/45 بخط أوضح، و10/20/40/50 ثم 5/25/35/55 أصغر.
// ظهور كل مستوى بيتحدد بالزووم (كلاسات q / m10 / m5 على الجدول).
function minuteRuler() {
  const r = el('div', 'mins');
  for (let m = 5; m < 60; m += 5) {
    const level = m % 15 === 0 ? 'q' : m % 10 === 0 ? 'm10' : 'm5';
    const s = el('span', level, String(m));
    s.style.insetInlineStart = `${(m / 60) * 100}%`;
    r.append(s);
  }
  return r;
}

// عنوان الساعة: الرقم + AM/PM (لما الخانة ضيقة بنخفي AM/PM لأن الصف نفسه بيوضحها)
function hourHead(h) {
  const s = el('span');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  s.append(el('b', null, String(h12)), el('b', 'hm', ':00'), el('i', 'hap', ` ${h < 12 ? 'AM' : 'PM'}`));
  return s;
}

function buildTrack(dateKey, half, occ, firstDay, nowMin) {
  const from = half * HALF, to = from + HALF;
  const track = el('div', 'track ' + (half ? 'pm' : 'am'));
  if (firstDay) track.classList.add('first-day');
  if (nowMin != null) track.classList.add('today-col');
  track.dataset.date = dateKey;
  track.dataset.half = half;

  // خانات الساعات في الخلفية (للتظليل والضغط)
  const slots = el('div', 'slots');
  for (let h = 0; h < 12; h++) {
    const hour = half * 12 + h;
    const slot = el('div', 'slot');
    if (hour < 7 || hour >= 18) slot.classList.add('night');
    slots.append(slot);
  }
  track.append(slots);

  // أجزاء المهام اللي بتقع في نص اليوم ده
  const segs = occ
    .filter(o => o.t.start < to && o.t.end > from)
    .map(o => ({ ...o, s: Math.max(o.t.start, from), e: Math.min(o.t.end, to) }))
    .sort((a, b) => a.s - b.s || b.e - a.e);

  // توزيع المهام المتداخلة على صفوف (lanes)
  const laneEnds = [];
  for (const seg of segs) {
    let lane = laneEnds.findIndex(end => end <= seg.s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = seg.e;
    seg.lane = lane;
  }
  const height = Math.max(TRACK_MIN_H, laneEnds.length * (LANE_H + LANE_GAP) + 6);
  track.style.height = `${height}px`;

  for (const seg of segs) track.append(taskBar(seg, from));

  if (nowMin != null && nowMin >= from && nowMin < to) {
    const line = el('div', 'nowline');
    line.style.insetInlineStart = `${((nowMin - from) / HALF) * 100}%`;
    track.append(line);
  }
  return track;
}

function taskBar({ t, date, done, s, e, lane }, from) {
  const bar = el('div', 'bar' + (done ? ' done' : ''));
  bar.draggable = true;
  bar.dataset.id = t.id;
  bar.dataset.date = date;
  if (t.color) bar.style.setProperty('--c', t.color);
  bar.style.insetInlineStart = `${((s - from) / HALF) * 100}%`;
  bar.style.width = `${((e - s) / HALF) * 100}%`;
  bar.style.top = `${3 + lane * (LANE_H + LANE_GAP)}px`;
  if (t.start < from) bar.classList.add('cont-start'); // مكمّلة من الصف اللي قبلها
  if (t.end > from + HALF) bar.classList.add('cont-end');

  const range = `${timeLabel(t.start)} – ${timeLabel(t.end)}`;
  bar.title = `${t.title}\n${range} (${durationLabel(t.end - t.start)})`
    + (t.repeat ? `\n${repeatSummary(t)}` : '')
    + (t.notes ? `\n\n${t.notes}` : '');

  const chk = el('span', 'chk', done ? '✓' : '');
  chk.title = done ? tr('markUndone') : tr('markDone');
  const text = el('div', 'btext');
  text.append(el('span', 'ctitle', (t.repeat ? '↻ ' : '') + t.title), el('span', 'btime', range));
  bar.append(chk, text);
  return bar;
}

// نقل ظهور مهمة ليوم/وقت تاني.
// لو المهمة متكررة: اليوم ده بس بيتفصل ويبقى مهمة لوحده، والتكرار يكمل عادي.
function moveOccurrence(task, fromDate, toDate, start, list = db.tasks) {
  const dur = task.end - task.start;
  start = Math.min(Math.max(0, start), 1440 - dur);
  if (task.repeat) {
    const wasDone = isOccDone(task, fromDate);
    setOccDone(task, fromDate, false);
    task.skip = [...(task.skip || []), fromDate];
    list.push({
      id: uid(), created: Date.now(), title: task.title, notes: task.notes, color: task.color,
      date: toDate, start, end: start + dur, done: wasDone, repeat: null,
    });
  } else {
    task.date = toDate;
    task.start = start;
    task.end = start + dur;
  }
}

// يحوّل مكان الماوس داخل الصف لدقيقة في اليوم
function pointerMinute(track, clientX) {
  const r = track.getBoundingClientRect();
  const rtl = getComputedStyle(track).direction === 'rtl';
  const frac = Math.min(1, Math.max(0, (rtl ? r.right - clientX : clientX - r.left) / r.width));
  return Number(track.dataset.half) * HALF + frac * HALF;
}
const snap = min => Math.floor(min / snapStep()) * snapStep();

// أحداث الجدول (تفويض)
const grid = $('#grid');
grid.addEventListener('click', e => {
  const bar = e.target.closest('.bar');
  if (bar && e.target.closest('.chk')) {
    const task = db.tasks.find(x => x.id === bar.dataset.id);
    if (task) { setOccDone(task, bar.dataset.date, !isOccDone(task, bar.dataset.date)); save(); renderTasks(); }
    return;
  }
  if (bar) { openTask(bar.dataset.id, bar.dataset.date); return; }
  const track = e.target.closest('.track');
  if (track) {
    const start = Math.min(snap(pointerMinute(track, e.clientX)), 1440 - snapStep());
    openTask(null, track.dataset.date, start, Math.min(start + 60, 1440));
  }
});

// السحب: بنحفظ المسافة بين مكان المسك وبداية المهمة عشان تتحرك بشكل طبيعي
let drag = null;
grid.addEventListener('dragstart', e => {
  const bar = e.target.closest('.bar');
  if (!bar) return;
  const task = db.tasks.find(x => x.id === bar.dataset.id);
  if (!task) return;
  drag = { task, date: bar.dataset.date, grab: pointerMinute(bar.closest('.track'), e.clientX) - task.start };
  e.dataTransfer.setData('text/plain', task.id);
  e.dataTransfer.effectAllowed = 'move';
});
grid.addEventListener('dragover', e => {
  const track = e.target.closest('.track');
  if (!track || !drag) return;
  e.preventDefault();
  grid.querySelectorAll('.track.drop').forEach(c => c !== track && c.classList.remove('drop'));
  track.classList.add('drop');
});
grid.addEventListener('dragleave', e => {
  const track = e.target.closest('.track');
  if (track && !track.contains(e.relatedTarget)) track.classList.remove('drop');
});
grid.addEventListener('drop', e => {
  const track = e.target.closest('.track');
  if (!track || !drag) return;
  e.preventDefault();
  const { task, grab, date } = drag;
  const start = Math.round((pointerMinute(track, e.clientX) - grab) / snapStep()) * snapStep();
  moveOccurrence(task, date, track.dataset.date, start);
  save();
  renderTasks();
});
grid.addEventListener('dragend', () => {
  drag = null;
  grid.querySelectorAll('.track.drop').forEach(c => c.classList.remove('drop'));
});

$('#prevWeek').addEventListener('click', () => { weekRef = addDays(weekRef, -7); renderWeek(); });
$('#nextWeek').addEventListener('click', () => { weekRef = addDays(weekRef, 7); renderWeek(); });
$('#todayBtn').addEventListener('click', () => { weekRef = weekStart(today()); renderWeek(); });

// تحديث خط الوقت الحالي كل دقيقة
setInterval(() => { if (!document.querySelector('dialog[open]')) renderWeek(); }, 60000);

/* ===================== نافذة المهمة ===================== */
const taskDialog = $('#taskDialog');
const taskForm = $('#taskForm');
let editingTaskId = null;
let editingOccDate = null; // اليوم اللي اتفتحت منه المهمة (مهم للمتكررة)

// 00:00 في خانة النهاية معناها نهاية اليوم (منتصف الليل)
const formStart = () => fromInputTime(taskForm.start.value);
const formEnd = () => fromInputTime(taskForm.end.value) || 1440;

function validateTimes() {
  const ok = !taskForm.start.value || !taskForm.end.value || formEnd() > formStart();
  taskForm.end.setCustomValidity(ok ? '' : t('endBeforeStart'));
  $('#taskDuration').textContent = ok && taskForm.start.value && taskForm.end.value
    ? t('duration', { d: durationLabel(formEnd() - formStart()) }) : '';
}
taskForm.start.addEventListener('input', validateTimes);
taskForm.end.addEventListener('input', validateTimes);

// ----- تعديل مهمة متكررة -----
// التاريخ في النافذة بيبدأ من اليوم اللي اتفتحت منه المهمة (editingOccDate).
// "هذا اليوم وكل اللي بعده": السلسلة القديمة بتقف قبل اليوم ده، وسلسلة جديدة بالتعديلات بتبدأ منه.
// "هذا اليوم فقط": اليوم ده بيتشال من السلسلة ويبقى مهمة عادية بالتعديلات.
// الأيام اللي قبل اليوم ده مش بتتأثر في الحالتين.

function seriesChanged(task, data) {
  const norm = x => JSON.stringify([
    x.title, x.date, x.start, x.end, x.notes || '', x.color || TASK_COLORS[0],
    x.repeat && [x.repeat.days.slice().sort(), x.repeat.until || ''],
  ]);
  return norm(task) !== norm(data);
}

// لو التاريخ في النافذة لسه هو اليوم المفتوح، يبقى المستخدم مغيّرش تاريخ البداية
const sameStart = (task, data) => ({ ...data, date: data.date === editingOccDate ? task.date : data.date });

function editFollowing(task, data) {
  if (!seriesChanged(task, sameStart(task, data))) return task;
  const split = editingOccDate;
  if (task.date >= split) { Object.assign(task, data); return task; }

  const before = d => d < split;
  const next = {
    id: uid(), created: Date.now(), done: false, ...data,
    skip: (task.skip || []).filter(d => !before(d)),
    doneDates: (task.doneDates || []).filter(d => !before(d)),
  };
  if (data.repeat && data.date < split) next.date = split; // ميرجعش يغطي على الأيام اللي فاتت

  task.skip = (task.skip || []).filter(before);
  task.doneDates = (task.doneDates || []).filter(before);
  task.repeat = { ...task.repeat, until: ymd(addDays(parseYmd(split), -1)) };
  dlgList().push(next);
  return next;
}

function editOne(task, data) {
  if (!seriesChanged(task, { ...sameStart(task, data), repeat: task.repeat })) return task;
  const occ = editingOccDate;
  const wasDone = isOccDone(task, occ);
  setOccDone(task, occ, false);
  task.skip = [...new Set([...(task.skip || []), occ])];
  const one = { id: uid(), created: Date.now(), ...data, repeat: null, done: wasDone };
  dlgList().push(one);
  return one;
}

const editScope = () => taskForm.scope.value; // 'following' | 'one'

// ----- لون المهمة -----
const TASK_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#f97316', '#eab308', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];
let taskColor = '';

function renderColorPicker() {
  const wrap = $('#taskColors');
  wrap.innerHTML = '';
  const isPreset = TASK_COLORS.includes(taskColor);
  for (const c of TASK_COLORS) {
    const b = el('button', 'swatch' + ((taskColor || TASK_COLORS[0]) === c ? ' selected' : ''));
    b.type = 'button';
    b.style.setProperty('--c', c);
    b.dataset.color = c;
    b.setAttribute('aria-label', c);
    wrap.append(b);
  }
  // لون مخصص من منتقي الألوان بتاع المتصفح
  const custom = el('label', 'custom-color' + (taskColor && !isPreset ? ' selected' : ''));
  custom.title = t('customColor');
  const input = el('input');
  input.type = 'color';
  input.value = taskColor && !isPreset ? taskColor : '#8b5cf6';
  custom.append(input, el('span', null, '+'));
  wrap.append(custom);
}

$('#taskColors').addEventListener('click', e => {
  const sw = e.target.closest('.swatch');
  if (!sw) return;
  taskColor = sw.dataset.color;
  renderColorPicker();
});
$('#taskColors').addEventListener('input', e => {
  if (e.target.type !== 'color') return;
  taskColor = e.target.value;
  $('#taskColors .selected')?.classList.remove('selected');
  e.target.parentElement.classList.add('selected');
});

// ----- أيام التكرار -----
const dayBoxes = () => [...taskForm.querySelectorAll('#repeatDays input')];
const selectedDays = () => dayBoxes().filter(b => b.checked).map(b => Number(b.value));

function renderDayChips(selected) {
  const wrap = $('#repeatDays');
  wrap.innerHTML = '';
  t('daysShort').forEach((name, i) => {
    const lbl = el('label', 'day-chip');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.value = i;
    cb.checked = selected.includes(i);
    lbl.append(cb, el('span', null, name));
    wrap.append(lbl);
  });
}

function updateRepeatUI() {
  // "هذا اليوم فقط" بيحوّل اليوم لمهمة عادية، فإعدادات التكرار بتستخبى
  const one = !$('#scopeBox').hidden && editScope() === 'one';
  const on = taskForm.repeat.checked && !one;
  $('#repeatRow').hidden = one;
  $('#repeatBox').hidden = !on;
  $('#dateLabel').textContent = t(on ? 'fStartFrom' : 'fDate');
  $('#doneLabel').textContent = t(taskForm.repeat.checked ? 'fDoneOcc' : 'fDone');
  taskForm.allDays.checked = selectedDays().length === 7;
  validateRepeat();
}

function validateRepeat() {
  const on = !$('#repeatBox').hidden;
  const first = dayBoxes()[0];
  if (first) first.setCustomValidity(on && !selectedDays().length ? t('repeatNoDays') : '');
  const until = taskForm.until.value;
  taskForm.until.setCustomValidity(on && until && until < taskForm.date.value ? t('untilBefore') : '');
}

taskForm.repeat.addEventListener('change', updateRepeatUI);
$('#scopeBox').addEventListener('change', updateRepeatUI);
taskForm.allDays.addEventListener('change', () => {
  dayBoxes().forEach(b => { b.checked = taskForm.allDays.checked; });
  validateRepeat();
});
$('#repeatDays').addEventListener('change', updateRepeatUI);
taskForm.until.addEventListener('input', validateRepeat);
taskForm.date.addEventListener('input', validateRepeat);

// store = 'tasks' (الجدول الأسبوعي) أو 'events' (التقويم)
let dlgStore = 'tasks';
const dlgList = () => db[dlgStore];

function openTask(id, date, start, end, store = 'tasks') {
  dlgStore = store;
  const task = id ? dlgList().find(x => x.id === id) : null;
  editingTaskId = task ? task.id : null;
  editingOccDate = date || (task && task.date);
  const rep = task && task.repeat;
  $('#taskDialogTitle').textContent = t(task ? 'taskEdit' : 'taskNew');
  taskForm.title.value = task ? task.title : '';
  taskForm.date.value = rep ? editingOccDate : task ? task.date : date;
  taskForm.start.value = toInputTime(task ? task.start : start);
  taskForm.end.value = toInputTime(task ? task.end : end);
  taskForm.notes.value = task ? task.notes || '' : '';
  taskColor = task && task.color || TASK_COLORS[0];
  renderColorPicker();
  taskForm.done.checked = task ? isOccDone(task, editingOccDate) : false;

  taskForm.repeat.checked = !!rep;
  $('#scopeBox').hidden = !rep;
  taskForm.scope.value = 'following';
  renderDayChips(rep ? rep.days : [dayIndex(editingOccDate)]);
  taskForm.until.value = rep ? rep.until || '' : '';
  updateRepeatUI();

  $('#taskDelete').hidden = !task;
  $('#taskDelete').textContent = t(rep ? 'deleteSeries' : 'delete');
  $('#taskDeleteOne').hidden = !rep;
  validateTimes();
  taskDialog.showModal();
  taskForm.title.focus();
}

taskForm.addEventListener('submit', () => {
  const repeat = !$('#repeatBox').hidden
    ? { days: selectedDays(), until: taskForm.until.value || '' }
    : null;
  const data = {
    title: taskForm.title.value.trim(),
    date: taskForm.date.value,
    start: formStart(),
    end: formEnd(),
    notes: taskForm.notes.value.trim(),
    color: taskColor,
    repeat,
  };
  if (!data.title || !data.date || data.end <= data.start) return;
  if (repeat && !repeat.days.length) return;
  let task = editingTaskId && dlgList().find(x => x.id === editingTaskId);
  if (task && task.repeat) task = editScope() === 'one' ? editOne(task, data) : editFollowing(task, data);
  else if (task) Object.assign(task, data);
  else {
    task = { id: uid(), created: Date.now(), done: false, ...data };
    dlgList().push(task);
  }
  // الشطب في المتكررة بيخص اليوم اللي فتحت منه بس
  setOccDone(task, task.repeat ? editingOccDate : task.date, taskForm.done.checked);
  save();
  renderTasks();
});

$('#taskDelete').addEventListener('click', () => {
  const task = dlgList().find(x => x.id === editingTaskId);
  if (!task || !confirm(t(task.repeat ? 'confirmDeleteSeries' : 'confirmDeleteTask'))) return;
  db[dlgStore] = dlgList().filter(x => x.id !== editingTaskId);
  save();
  taskDialog.close();
  renderTasks();
});

// حذف يوم واحد من مهمة متكررة
$('#taskDeleteOne').addEventListener('click', () => {
  const task = dlgList().find(x => x.id === editingTaskId);
  if (!task || !task.repeat) return;
  setOccDone(task, editingOccDate, false);
  task.skip = [...new Set([...(task.skip || []), editingOccDate])];
  save();
  taskDialog.close();
  renderTasks();
});

/* ===================== التقويم (شهري / سنوي) ===================== */
// ليه قايمة خاصة بيه (db.events) منفصلة عن مهام الجدول الأسبوعي.
const CAL_MODE_KEY = 'organizeit.calMode';
let calMode = 'month';
try { if (['month', 'year'].includes(localStorage.getItem(CAL_MODE_KEY))) calMode = localStorage.getItem(CAL_MODE_KEY); } catch (e) {}
let calRef = today();
let calDrag = null;

// كل الجداول بتتحدّث مع بعض بعد أي تغيير في المهام
function renderTasks() { renderWeek(); renderCalendar(); }

const occurrencesOn = key => {
  const idx = dayIndex(key);
  return db.events
    .filter(task => occursOn(task, key, idx))
    .map(task => ({ t: task, date: key, done: isOccDone(task, key) }))
    .sort((a, b) => a.t.start - b.t.start || a.t.created - b.t.created);
};

function renderCalendar() {
  $('#zoom-month').hidden = calMode !== 'month';
  document.querySelectorAll('[data-cal]').forEach(b => b.classList.toggle('active', b.dataset.cal === calMode));
  $('#calLabel').textContent = calMode === 'month' ? fmtMonthYear.format(calRef) : String(calRef.getFullYear());
  calMode === 'month' ? renderMonth() : renderYear();
}

function renderMonth() {
  const body = $('#calBody');
  body.innerHTML = '';
  const first = new Date(calRef.getFullYear(), calRef.getMonth(), 1);
  const last = new Date(calRef.getFullYear(), calRef.getMonth() + 1, 0);
  const todayKey = ymd(today());

  const wrap = el('div', 'month-wrap');
  const grid = el('div', 'month-grid');
  t('days').forEach((name, i) => {
    const h = el('div', 'mhead');
    h.append(el('span', 'full', name), el('span', 'short', t('daysShort')[i])); // القصير للموبايل
    grid.append(h);
  });

  let done = 0, total = 0;
  for (let d = weekStart(first); d <= last || dayIndex(ymd(d)) !== 0; d = addDays(d, 1)) {
    const key = ymd(d);
    const inMonth = d.getMonth() === first.getMonth();
    const occ = occurrencesOn(key);
    const dayDone = occ.filter(o => o.done).length;
    if (inMonth) { total += occ.length; done += dayDone; }

    const cell = el('div', 'mday' + (inMonth ? '' : ' out') + (key === todayKey ? ' today' : ''));
    cell.dataset.date = key;
    const head = el('div', 'mday-head');
    head.append(el('span', 'mnum', String(d.getDate())));
    if (occ.length) {
      const c = el('span', 'mcount' + (dayDone === occ.length ? ' full' : ''), `${dayDone}/${occ.length}`);
      c.title = t('weekStats', { done: dayDone, total: occ.length });
      head.append(c);
    }
    const list = el('div', 'mlist');
    for (const o of occ) list.append(monthChip(o));
    cell.append(head, list);
    grid.append(cell);
  }
  wrap.append(grid);
  body.append(wrap);
  renderProgress($('#calStats'), done, total, 'monthProgress');
  applyZoom('month');
}

function monthChip({ t: task, date, done }) {
  const chip = el('div', 'mchip' + (done ? ' done' : ''));
  chip.draggable = true;
  chip.dataset.id = task.id;
  chip.dataset.date = date;
  if (task.color) chip.style.setProperty('--c', task.color);
  chip.title = `${task.title}\n${timeLabel(task.start)} – ${timeLabel(task.end)}`
    + (task.repeat ? `\n${repeatSummary(task)}` : '') + (task.notes ? `\n\n${task.notes}` : '');
  const chk = el('span', 'chk', done ? '✓' : '');
  chk.title = t(done ? 'markUndone' : 'markDone');
  const text = el('span', 'mtext');
  text.append(el('span', 'mtitle', (task.repeat ? '↻ ' : '') + task.title), el('span', 'mtime', `${timeLabel(task.start)} – ${timeLabel(task.end)}`));
  chip.append(chk, text);
  return chip;
}

function renderYear() {
  const body = $('#calBody');
  body.innerHTML = '';
  const year = calRef.getFullYear();
  const todayKey = ymd(today());
  const grid = el('div', 'year-grid');
  let done = 0, total = 0;

  for (let m = 0; m < 12; m++) {
    const first = new Date(year, m, 1);
    const card = el('section', 'ymonth');
    const head = el('button', 'yhead', fmtMonth.format(first));
    head.dataset.month = m;
    const days = el('div', 'ydays');
    for (const name of t('daysMini')) days.append(el('span', 'ydow', name));
    for (let i = 0; i < dayIndex(ymd(first)); i++) days.append(el('span', 'yd blank'));

    for (let d = first; d.getMonth() === m; d = addDays(d, 1)) {
      const key = ymd(d);
      const occ = occurrencesOn(key);
      const dayDone = occ.filter(o => o.done).length;
      total += occ.length; done += dayDone;
      const cell = el('button', 'yd' + (key === todayKey ? ' today' : ''), String(d.getDate()));
      cell.dataset.date = key;
      if (occ.length) {
        cell.classList.add(dayDone === occ.length ? 'all-done' : 'has');
        cell.title = `${fmtFull.format(d)}\n${t('weekStats', { done: dayDone, total: occ.length })}\n`
          + occ.slice(0, 6).map(o => `• ${timeLabel(o.t.start)} ${o.t.title}`).join('\n')
          + (occ.length > 6 ? '\n…' : '');
      }
      days.append(cell);
    }
    card.append(head, days);
    grid.append(card);
  }
  body.append(grid);
  renderProgress($('#calStats'), done, total, 'yearProgress');
}

function openMonth(date) {
  calMode = 'month';
  calRef = date;
  try { localStorage.setItem(CAL_MODE_KEY, calMode); } catch (e) {}
  renderCalendar();
}

const calBody = $('#calBody');
calBody.addEventListener('click', e => {
  // السنوي: أي يوم أو اسم شهر بيفتح الشهر ده
  const yd = e.target.closest('.yd[data-date]');
  if (yd) { openMonth(parseYmd(yd.dataset.date)); return; }
  const yh = e.target.closest('.yhead');
  if (yh) { openMonth(new Date(calRef.getFullYear(), Number(yh.dataset.month), 1)); return; }

  // الشهري
  const chip = e.target.closest('.mchip');
  if (chip && e.target.closest('.chk')) {
    const task = db.events.find(x => x.id === chip.dataset.id);
    if (task) { setOccDone(task, chip.dataset.date, !isOccDone(task, chip.dataset.date)); save(); renderTasks(); }
    return;
  }
  if (chip) { openTask(chip.dataset.id, chip.dataset.date, null, null, 'events'); return; }
  const day = e.target.closest('.mday');
  if (day) openTask(null, day.dataset.date, 9 * 60, 10 * 60, 'events');
});

// سحب مهمة ليوم تاني في الشهر (بنفس وقتها)
calBody.addEventListener('dragstart', e => {
  const chip = e.target.closest('.mchip');
  if (!chip) return;
  calDrag = { task: db.events.find(x => x.id === chip.dataset.id), date: chip.dataset.date };
  e.dataTransfer.setData('text/plain', chip.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
});
calBody.addEventListener('dragover', e => {
  const day = e.target.closest('.mday');
  if (!day || !calDrag) return;
  e.preventDefault();
  calBody.querySelectorAll('.mday.drop').forEach(c => c !== day && c.classList.remove('drop'));
  day.classList.add('drop');
});
calBody.addEventListener('dragleave', e => {
  const day = e.target.closest('.mday');
  if (day && !day.contains(e.relatedTarget)) day.classList.remove('drop');
});
calBody.addEventListener('drop', e => {
  const day = e.target.closest('.mday');
  if (!day || !calDrag || !calDrag.task) return;
  e.preventDefault();
  if (day.dataset.date !== calDrag.date) {
    moveOccurrence(calDrag.task, calDrag.date, day.dataset.date, calDrag.task.start, db.events);
    save();
  }
  renderTasks();
});
calBody.addEventListener('dragend', () => {
  calDrag = null;
  calBody.querySelectorAll('.mday.drop').forEach(c => c.classList.remove('drop'));
});

function shiftCal(dir) {
  calRef = calMode === 'month'
    ? new Date(calRef.getFullYear(), calRef.getMonth() + dir, 1)
    : new Date(calRef.getFullYear() + dir, 0, 1);
  renderCalendar();
}
$('#calPrev').addEventListener('click', () => shiftCal(-1));
$('#calNext').addEventListener('click', () => shiftCal(1));
$('#calToday').addEventListener('click', () => { calRef = today(); renderCalendar(); });
document.querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => {
  calMode = b.dataset.cal;
  try { localStorage.setItem(CAL_MODE_KEY, calMode); } catch (e) {}
  renderCalendar();
}));

/* ===================== الأهداف ===================== */
// الأهداف شجرة: كل هدف ممكن يكون ليه parentId، والعمق مفتوح.
// الهدف اللي تحته أهداف فرعية حالته (تم / لسه) محسوبة من الأهداف اللي تحته.
const goalRefs = { year: today(), month: today(), week: today(), day: today(), backlog: today() };
let addingUnder = null; // id الهدف اللي فاتحين تحته خانة إضافة
let treeDepth = 0;      // أعمق مستوى ظاهر في الكارت (عشان عرض الـ scroll الأفقي)
let maxCard = null;     // الكارت المكبّر حاليًا
try { if (GOAL_TYPES.includes(localStorage.getItem(MAX_KEY))) maxCard = localStorage.getItem(MAX_KEY); } catch (e) {}

function setMaxCard(type) {
  maxCard = type;
  try { type ? localStorage.setItem(MAX_KEY, type) : localStorage.removeItem(MAX_KEY); } catch (e) {}
  renderGoals();
}

const childrenOf = (list, parentId) => list
  .filter(g => (g.parentId || null) === parentId)
  .sort((a, b) => a.created - b.created);

function descendants(id) {
  const out = [];
  const walk = pid => { for (const g of db.goals) if (g.parentId === pid) { out.push(g); walk(g.id); } };
  walk(id);
  return out;
}

// عدد الأهداف النهائية (اللي ملهاش فروع) في الفرع، والمنجز منها
function goalStats(g, list) {
  const kids = childrenOf(list, g.id);
  if (!kids.length) return { total: 1, done: g.done ? 1 : 0 };
  return kids.reduce((acc, k) => {
    const s = goalStats(k, list);
    acc.total += s.total; acc.done += s.done;
    return acc;
  }, { total: 0, done: 0 });
}

const isGoalDone = (g, list) => { const s = goalStats(g, list); return s.done === s.total; };

function setGoalDone(g, done) {
  g.done = done;
  for (const d of descendants(g.id)) d.done = done;
}

function periodDate(type, period) {
  if (type === 'year') return new Date(Number(period), 0, 1);
  if (type === 'month') return parseYmd(`${period}-01`);
  if (type === 'backlog') return today();
  return parseYmd(period);
}

const goalsIn = (type, period) => db.goals.filter(g => g.type === type && g.period === period);

function addForm(parentId) {
  const form = el('form', 'gadd' + (parentId ? ' sub' : ''));
  if (parentId) form.dataset.parent = parentId;
  const input = el('input');
  input.name = 'title';
  input.placeholder = t(parentId ? 'subPlaceholder' : 'rootPlaceholder');
  input.maxLength = 200;
  input.autocomplete = 'off';
  form.append(input, el('button', 'btn primary', t('add')));
  return form;
}

function goalNode(g, list, depth = 0) {
  treeDepth = Math.max(treeDepth, depth);
  const kids = childrenOf(list, g.id);
  const s = goalStats(g, list);
  const done = s.done === s.total;
  const expanded = !g.collapsed || addingUnder === g.id;

  const li = el('li', done ? 'done' : '');
  li.dataset.id = g.id;

  const row = el('div', 'gnode');
  const tog = el('button', 'icon-btn tog', kids.length ? (expanded ? '▾' : t('arrowCollapsed')) : '');
  tog.dataset.act = 'toggle';
  tog.title = t(expanded ? 'collapse' : 'expand');
  if (!kids.length) tog.disabled = true;

  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = done;
  cb.indeterminate = kids.length > 0 && s.done > 0 && !done;
  cb.title = t(kids.length ? 'markDoneTree' : 'markDone');

  const title = el('span', 'gtitle', g.title);
  if (kids.length) title.append(el('span', 'gcount', `${s.done}/${s.total}`));
  if (g.notes) title.append(el('small', null, g.notes));

  const add = el('button', 'icon-btn', '+'); add.dataset.act = 'add'; add.title = t('addSub');
  const edit = el('button', 'icon-btn', '✎'); edit.dataset.act = 'edit'; edit.title = t('edit');
  const del = el('button', 'icon-btn del', '✕'); del.dataset.act = 'del'; del.title = t('delete');
  // الشطب مع باقي أزرار التحكم في آخر السطر
  const actions = el('span', 'gactions');
  actions.append(cb, add, edit, del);

  row.append(tog);
  if (depth === 0) row.append(el('span', 'gstar', '★')); // نجمة للأهداف الرئيسية
  row.append(title, actions);
  li.append(row);

  if (expanded && (kids.length || addingUnder === g.id)) {
    const ul = el('ul', 'gtree');
    for (const k of kids) ul.append(goalNode(k, list, depth + 1));
    if (addingUnder === g.id) {
      const formLi = el('li');
      formLi.append(addForm(g.id));
      treeDepth = Math.max(treeDepth, depth + 1);
      ul.append(formLi);
    }
    li.append(ul);
  }
  return li;
}

function renderGoals() {
  const wrap = $('#goalCards');
  wrap.innerHTML = '';
  wrap.classList.toggle('has-max', !!maxCard);
  for (const type of GOAL_TYPES) {
    if (maxCard && maxCard !== type) continue;
    const ref = goalRefs[type];
    const list = goalsIn(type, periodKey(type, ref));
    // أي هدف أبوه مش موجود يتعامل كهدف رئيسي
    const ids = new Set(list.map(g => g.id));
    const roots = list.filter(g => !g.parentId || !ids.has(g.parentId)).sort((a, b) => a.created - b.created);

    let total = 0, done = 0;
    for (const r of roots) { const s = goalStats(r, list); total += s.total; done += s.done; }

    const card = el('section', 'gcard' + (type === 'backlog' ? ' backlog' : '') + (maxCard === type ? ' max' : ''));
    card.dataset.type = type;

    const head = el('header');
    const prev = el('button', 'icon-btn', t('arrowPrev')); prev.dataset.nav = '-1'; prev.title = t('prev');
    const next = el('button', 'icon-btn', t('arrowNext')); next.dataset.nav = '1'; next.title = t('next');
    const now = el('button', 'icon-btn', '●'); now.dataset.nav = '0'; now.title = t('current');
    const max = el('button', 'icon-btn maxbtn', maxCard === type ? '⤡' : '⤢');
    max.dataset.max = type;
    max.title = t(maxCard === type ? 'restore' : 'maximize');
    if (type === 'backlog') head.append(el('h3', null, t('goals_backlog')), el('span', 'period muted', t('backlogHint')), max);
    else head.append(el('h3', null, t(`goals_${type}`)), prev, el('span', 'period', periodLabel(type, ref)), now, next, max);

    const bar = el('div', 'progress');
    const fill = el('div');
    fill.style.width = total ? `${(done / total) * 100}%` : '0';
    bar.append(fill);

    const stats = el('div', 'gstats muted', total ? t('goalStats', { done, total }) : '');

    const tree = el('ul', 'gtree root');
    treeDepth = 0;
    const flat = roots.every(r => !childrenOf(list, r.id).length && addingUnder !== r.id);
    tree.classList.toggle('flat', flat);
    if (!roots.length) tree.append(el('li', 'gempty', t('noGoals')));
    for (const r of roots) tree.append(goalNode(r, list));

    tree.style.setProperty('--depth', treeDepth);
    const scroll = el('div', 'gtree-scroll');
    scroll.append(tree);
    card.append(head, bar, stats, scroll, addForm(null));
    wrap.append(card);
  }
  markScrollingTrees();
}

// بعد الرسم: نوسّع الشجرة على قد أطول سطر فيها، عشان كل سطر (والأزرار اللازقة فيه)
// ياخد عرض الـ scroll كله. وظل خفيف جنب الأزرار لما يكون فيه محتوى بيعدّي تحتها.
function markScrollingTrees() {
  document.querySelectorAll('.gtree-scroll').forEach(sc => {
    const root = sc.querySelector('.gtree.root');
    root.style.minWidth = '';
    // كل سطر بيتمد لحد بداية الشجرة (هامش بالسالب، وأول عنصر ظاهر فيه بياخد نفس المسافة
    // فالاسم مكانه ما يتغيرش)، عشان الأزرار اللازقة تقدر تفضل ظاهرة حتى في السطور العميقة.
    // (الـ sticky محدود بمساحة محتوى السطر، فلازم المسافة تبقى margin على العنصر مش padding على السطر)
    const rtl = getComputedStyle(root).direction === 'rtl';
    const rr = root.getBoundingClientRect();
    root.querySelectorAll('.gnode').forEach(n => {
      const first = [...n.children].find(c => c.getClientRects().length);
      n.style.marginInlineStart = '';
      if (first) first.style.marginInlineStart = '';
      const r = n.getBoundingClientRect();
      const off = Math.round(rtl ? rr.right - r.right : r.left - rr.left);
      if (off > 0 && first) { n.style.marginInlineStart = `${-off}px`; first.style.marginInlineStart = `${off}px`; }
    });
    let extra = 0;
    root.querySelectorAll('.gnode').forEach(n => { extra = Math.max(extra, n.scrollWidth - n.clientWidth); });
    if (extra > 0) root.style.minWidth = `${root.offsetWidth + extra}px`;
    sc.classList.toggle('scrolling', sc.scrollWidth > sc.clientWidth + 1);
  });
}
window.addEventListener('resize', markScrollingTrees);

/* ===================== الزووم (الجدول الأسبوعي والتقويم الشهري) ===================== */
// الزووم بيوسّع الخانات بس، والخط بيفضل بنفس حجمه، فالنصوص الطويلة بتبان أكتر.
// 100% = الجدول على قد عرض الشاشة بالظبط (أقل حاجة)، وكل خطوة بتضرب عرض العمود.
const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6];
const zoom = { week: null, month: null };
try {
  for (const k of Object.keys(zoom)) {
    const v = Number(localStorage.getItem(`organizeit.zoom.${k}`));
    if (ZOOM_STEPS.includes(v)) zoom[k] = v;
  }
} catch (e) {}

const zoomTargets = kind => kind === 'week'
  ? { wrap: $('.grid-wrap'), grid: $('#grid'), cols: 12 }
  : { wrap: $('.month-wrap'), grid: $('.month-grid'), cols: 7 };

function applyZoom(kind) {
  const { wrap, grid, cols } = zoomTargets(kind);
  if (!wrap || !grid || !wrap.clientWidth) return; // التبويب مستخبي
  if (kind === 'week') fitWeekHeight(wrap);
  const labelW = parseFloat(getComputedStyle(grid).getPropertyValue('--label-w')) || 0;
  const fit = (wrap.clientWidth - labelW) / cols;
  // أول مرة في الأسبوعي: لو الشاشة ضيقة (موبايل) نبدأ بزووم يخلي الساعة مقروءة (~90px)، وإلا على قد الشاشة
  if (zoom[kind] == null) zoom[kind] = kind === 'week' ? (ZOOM_STEPS.find(z => fit * z >= 90) || ZOOM_STEPS.at(-1)) : 1;
  const ratio = wrap.scrollWidth > wrap.clientWidth ? wrap.scrollLeft / wrap.scrollWidth : 0;
  const col = Math.floor(fit * zoom[kind] * 100) / 100;
  grid.style.setProperty('--col-w', `${col}px`);
  grid.classList.toggle('narrow', col < 70);
  grid.classList.toggle('tiny', col < 46); // الخانة صغيرة جدًا: رقم الساعة بس
  // كسور الساعة حسب الزووم
  grid.classList.toggle('q', col >= 120);
  grid.classList.toggle('m10', col >= 240);
  grid.classList.toggle('m5', col >= 400);
  wrap.scrollLeft = ratio * wrap.scrollWidth; // نفضل في نفس المكان تقريبًا
  const box = document.getElementById(`zoom-${kind}`);
  if (box) {
    box.querySelector('.zoom-val').textContent = `${Math.round(zoom[kind] * 100)}%`;
    box.querySelector('[data-zoom="-1"]').disabled = zoom[kind] === ZOOM_STEPS[0];
    box.querySelector('[data-zoom="1"]').disabled = zoom[kind] === ZOOM_STEPS.at(-1);
  }
}

// الجدول الأسبوعي ياخد باقي ارتفاع الشاشة، والـ scroll الرأسي يبقى جواه
function fitWeekHeight(wrap) {
  const top = wrap.getBoundingClientRect().top + window.scrollY;
  const padBottom = parseFloat(getComputedStyle(wrap.closest('.view')).paddingBottom) || 0;
  wrap.style.maxHeight = `${Math.max(320, Math.floor(window.innerHeight - top - padBottom))}px`;
}

function setZoom(kind, dir) {
  const i = ZOOM_STEPS.indexOf(zoom[kind] ?? 1);
  const next = dir === 0 ? 1 : ZOOM_STEPS[Math.min(Math.max(i + dir, 0), ZOOM_STEPS.length - 1)];
  if (next === zoom[kind]) return;
  zoom[kind] = next;
  try { localStorage.setItem(`organizeit.zoom.${kind}`, next); } catch (e) {}
  applyZoom(kind);
}

document.querySelectorAll('.zoom').forEach(box => box.addEventListener('click', e => {
  const b = e.target.closest('[data-zoom]');
  if (b) setZoom(box.dataset.kind, Number(b.dataset.zoom));
}));

// Ctrl + عجلة الماوس (أو pinch على التاتش باد) فوق الجدول
let lastWheel = 0;
for (const [sel, kind] of [['.grid-wrap', 'week'], ['#calBody', 'month']]) {
  $(sel).addEventListener('wheel', e => {
    if (!e.ctrlKey || (kind === 'month' && calMode !== 'month')) return;
    e.preventDefault();
    if (Date.now() - lastWheel < 120) return;
    lastWheel = Date.now();
    setZoom(kind, e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}

window.addEventListener('resize', () => { applyZoom('week'); applyZoom('month'); });

/* ===================== حفظ الأسبوع كصورة / PDF ===================== */
// بنرسم الأسبوع كله على canvas بنفسنا (من غير أي مكتبة)، بألوان فاتحة مناسبة للطباعة والمشاركة.
// الـ PDF بيتعمل يدويًا: صفحة A4 عرضي جواها نفس الصورة (JPEG).
const EXP = {
  W: 1600, PAD: 24, TITLE_H: 58, HEAD_H: 56, LABEL_W: 130,
  LANE_H: 36, LANE_GAP: 4, TRACK_MIN: 48, SCALE: 2,
  font: '"Segoe UI", Tahoma, "Noto Sans Arabic", Arial, sans-serif',
  c: { bg: '#ffffff', text: '#1d2330', muted: '#6b7280', line: '#d5d9e0', strong: '#1d2330', night: '#f1f3f6', today: '#fff7d6', accent: '#2563eb', done: '#16a34a' },
};

function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x2563eb;
  return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`;
}

// يقصّ النص بـ … لو أطول من العرض المتاح
function fitText(ctx, text, maxW) {
  if (maxW <= 8) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo ? text.slice(0, lo) + '…' : '';
}

// توزيع المهام المتداخلة على صفوف (نفس منطق الجدول)
function layoutLanes(occ, from) {
  const to = from + HALF;
  const segs = occ
    .filter(o => o.t.start < to && o.t.end > from)
    .map(o => ({ ...o, s: Math.max(o.t.start, from), e: Math.min(o.t.end, to) }))
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const ends = [];
  for (const seg of segs) {
    let lane = ends.findIndex(end => end <= seg.s);
    if (lane === -1) { lane = ends.length; ends.push(0); }
    ends[lane] = seg.e;
    seg.lane = lane;
  }
  return { segs, lanes: ends.length };
}

function renderWeekCanvas() {
  const { W, PAD, TITLE_H, HEAD_H, LABEL_W, LANE_H, LANE_GAP, TRACK_MIN, SCALE, c, font } = EXP;
  const rtl = lang === 'ar';
  const colW = (W - PAD * 2 - LABEL_W) / 12;
  const trackH = lanes => Math.max(TRACK_MIN, lanes * (LANE_H + LANE_GAP) + 8);

  // البيانات والمقاسات
  let total = 0, done = 0;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekRef, i), key = ymd(date);
    const occ = db.tasks.filter(task => occursOn(task, key, i)).map(task => ({ t: task, date: key, done: isOccDone(task, key) }));
    total += occ.length; done += occ.filter(o => o.done).length;
    const halves = [0, 1].map(h => layoutLanes(occ, h * HALF));
    days.push({ i, date, key, occ, halves, heights: halves.map(h => trackH(h.lanes)) });
  }
  const H = PAD * 2 + TITLE_H + HEAD_H + days.reduce((sum, d) => sum + d.heights[0] + d.heights[1], 0);

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);

  // x منطقي من بداية السطر → x حقيقي (بيتعكس في العربي)
  const X = (x, w = 0) => (rtl ? W - x - w : x);
  const text = (str, x, y, { size = 13, weight = 400, color = c.text, align = 'start', dir = rtl ? 'rtl' : 'ltr', maxW } = {}) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.direction = dir;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(maxW ? fitText(ctx, str, maxW) : str, x, y);
  };
  const line = (x1, y1, x2, y2, color = c.line, w = 1, dash) => {
    ctx.beginPath();
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []);
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
  };
  const startX = x => X(x); // نقطة بداية نص في اتجاه السطر

  // العنوان
  const titleY = PAD + TITLE_H / 2 - 6;
  text(`${t('tabWeek')} · ${weekRangeLabel(weekRef)}`, startX(PAD), titleY, { size: 22, weight: 700 });
  const p = total ? Math.round((done / total) * 100) : 0;
  text(total ? `${t('weekProgress')}: ${p}% (${done}/${total})` : '', X(W - PAD), titleY, { size: 14, color: c.muted, align: 'end' });

  // الجدول
  const gx = PAD, gy = PAD + TITLE_H, gw = W - PAD * 2;
  const gridX0 = PAD + LABEL_W; // بداية الساعات (منطقي)
  ctx.fillStyle = c.bg;
  ctx.fillRect(gx, gy, gw, H - gy - PAD);

  // صف الساعات (AM فوق، PM تحت)
  const rowH = HEAD_H / 2;
  ctx.fillStyle = c.night;
  ctx.fillRect(X(gridX0, gw - LABEL_W), gy + rowH, gw - LABEL_W, rowH);
  text('#', X(gx + LABEL_W / 2), gy + HEAD_H / 2, { size: 18, weight: 700, align: 'center' });
  for (let h = 0; h < 12; h++) {
    const x = gridX0 + h * colW;
    const lx = rtl ? X(x, colW) + 8 : x + 8; // نصوص الساعات LTR دايمًا
    text(hourLabel(h), lx, gy + rowH / 2, { size: 12, weight: 700, dir: 'ltr', align: 'left' });
    text(hourLabel(h + 12), lx, gy + rowH * 1.5, { size: 12, weight: 700, dir: 'ltr', align: 'left' });
  }
  line(gx, gy + rowH, gx + gw, gy + rowH);

  // الأيام
  let y = gy + HEAD_H;
  const todayKey = ymd(today());
  for (const d of days) {
    const dayH = d.heights[0] + d.heights[1];
    if (d.key === todayKey) { ctx.fillStyle = c.today; ctx.fillRect(gx, y, gw, dayH); }

    // عمود اسم اليوم
    const dDone = d.occ.filter(o => o.done).length;
    const cx = X(gx + LABEL_W / 2);
    text(t('days')[d.i], cx, y + dayH / 2 - (d.occ.length ? 16 : 8), { size: 16, weight: 700, align: 'center' });
    text(fmtDayMonth.format(d.date), cx, y + dayH / 2 + (d.occ.length ? 2 : 10), { size: 12, color: c.muted, align: 'center' });
    if (d.occ.length) {
      const dp = Math.round((dDone / d.occ.length) * 100);
      text(`${dp}% (${dDone}/${d.occ.length})`, cx, y + dayH / 2 + 20, { size: 11, weight: 700, color: dp === 100 ? c.done : c.accent, align: 'center' });
    }

    // الصفين (AM / PM)
    let ty = y;
    for (let half = 0; half < 2; half++) {
      const th = d.heights[half];
      for (let h = 0; h < 12; h++) {
        const hour = half * 12 + h;
        if ((hour < 7 || hour >= 18) && d.key !== todayKey) {
          ctx.fillStyle = c.night;
          ctx.fillRect(X(gridX0 + h * colW, colW), ty, colW, th);
        }
      }
      for (const seg of d.halves[half].segs) drawBar(seg, half * HALF, ty);
      if (half === 0) line(X(gridX0), ty + th, X(gx + gw), ty + th, c.line, 1, [4, 3]);
      ty += th;
    }
    line(gx, y, gx + gw, y, c.strong, 1.5);
    y += dayH;
  }

  // الخطوط الرأسية للساعات وعمود الأيام
  for (let h = 0; h <= 12; h++) {
    const x = X(gridX0 + h * colW);
    line(x, gy, x, y, h === 0 ? c.strong : c.line, h === 0 ? 1.5 : 1);
  }
  ctx.strokeStyle = c.strong; ctx.lineWidth = 1.5;
  ctx.strokeRect(gx, gy, gw, y - gy);
  line(gx, gy + HEAD_H, gx + gw, gy + HEAD_H, c.strong, 2);

  function drawBar({ t: task, done: isDone, s, e, lane }, from, trackY) {
    const color = task.color || c.accent;
    const bx = gridX0 + ((s - from) / 60) * colW, bw = Math.max(4, ((e - s) / 60) * colW);
    const rx = X(bx, bw), ry = trackY + 4 + lane * (LANE_H + LANE_GAP);
    ctx.save();
    ctx.globalAlpha = isDone ? 0.55 : 1;
    ctx.beginPath(); ctx.roundRect(rx, ry, bw, LANE_H, 5);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.fillStyle = hexToRgba(color, 0.2); ctx.fill();
    ctx.strokeStyle = hexToRgba(color, 0.5); ctx.lineWidth = 1; ctx.stroke();
    ctx.clip();
    ctx.fillStyle = color; // الإطار الجانبي الغامق
    ctx.fillRect(rtl ? rx + bw - 5 : rx, ry, 5, LANE_H);
    const innerW = bw - 16;
    const tx = rtl ? rx + bw - 10 : rx + 10;
    const title = (task.repeat ? '↻ ' : '') + task.title;
    text(title, tx, ry + 12, { size: 12.5, weight: 700, maxW: innerW });
    if (isDone) { // خط الشطب
      ctx.font = `700 12.5px ${font}`;
      const w = Math.min(ctx.measureText(fitText(ctx, title, innerW)).width, innerW);
      line(rtl ? tx - w : tx, ry + 12, rtl ? tx : tx + w, ry + 12, c.text, 1.2);
    }
    const range = `${timeLabel(task.start)} – ${timeLabel(task.end)}`;
    ctx.font = `400 10.5px ${font}`;
    text(fitText(ctx, range, innerW), tx, ry + 27, { size: 10.5, color: c.muted, dir: 'ltr', align: rtl ? 'right' : 'left' });
    ctx.restore();
  }

  return canvas;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// PDF صفحة واحدة A4 (عرضي أو طولي حسب شكل الصورة) جواها صورة JPEG
function jpegToPdf(jpeg, imgW, imgH) {
  const landscape = imgW >= imgH;
  const pageW = landscape ? 841.89 : 595.28, pageH = landscape ? 595.28 : 841.89, m = 24;
  const scale = Math.min((pageW - m * 2) / imgW, (pageH - m * 2) / imgH);
  const dw = imgW * scale, dh = imgH * scale;
  const x = (pageW - dw) / 2, y = pageH - m - dh; // متثبتة من فوق

  const enc = new TextEncoder();
  const parts = [], offsets = [];
  let len = 0;
  const push = p => { const b = typeof p === 'string' ? enc.encode(p) : p; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = len;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xref = len;
  let tail = 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n++) tail += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(tail);
  return new Blob(parts, { type: 'application/pdf' });
}

const weekFileName = ext => `week-${ymd(weekRef)}.${ext}`;

$('#saveImgBtn').addEventListener('click', () => {
  renderWeekCanvas().toBlob(blob => downloadBlob(blob, weekFileName('png')), 'image/png');
});

$('#savePdfBtn').addEventListener('click', () => {
  const canvas = renderWeekCanvas();
  const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  const bin = atob(b64);
  const jpeg = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);
  downloadBlob(jpegToPdf(jpeg, canvas.width, canvas.height), weekFileName('pdf'));
});


const goalCards = $('#goalCards');
goalCards.addEventListener('click', e => {
  const card = e.target.closest('.gcard');
  if (!card) return;
  const type = card.dataset.type;

  if (e.target.closest('[data-max]')) { setMaxCard(maxCard === type ? null : type); return; }

  const nav = e.target.closest('[data-nav]');
  if (nav) {
    const dir = Number(nav.dataset.nav);
    goalRefs[type] = dir ? shiftPeriod(type, goalRefs[type], dir) : today();
    addingUnder = null;
    renderGoals();
    return;
  }

  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const g = db.goals.find(x => x.id === li.dataset.id);
  if (!g) return;

  if (e.target.type === 'checkbox' && e.target.closest('.gnode')) {
    setGoalDone(g, e.target.checked); save(); renderGoals();
    return;
  }
  const act = e.target.closest('[data-act]');
  if (!act || act.closest('li[data-id]') !== li) return;
  switch (act.dataset.act) {
    case 'toggle':
      g.collapsed = !g.collapsed; save(); renderGoals();
      break;
    case 'add':
      addingUnder = addingUnder === g.id ? null : g.id;
      renderGoals();
      focusAdd(addingUnder);
      break;
    case 'edit':
      openGoal(g.id);
      break;
    case 'del':
      deleteGoal(g);
      break;
  }
});

goalCards.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const card = form.closest('.gcard');
  const title = form.title.value.trim();
  if (!title) return;
  const type = card.dataset.type;
  const parentId = form.dataset.parent || null;
  const parent = parentId && db.goals.find(x => x.id === parentId);
  db.goals.push({
    id: uid(), created: Date.now(), type,
    period: parent ? parent.period : periodKey(type, goalRefs[type]),
    parentId, title, notes: '', done: false,
  });
  save();
  renderGoals();
  // الخانة تفضل مفتوحة عشان تضيف كذا هدف ورا بعض
  if (parentId) focusAdd(parentId);
  else card.parentNode.querySelector(`.gcard[data-type="${type}"] > .gadd input`).focus();
});

// Escape يقفل خانة الإضافة الفرعية، وإلا يرجّع الكارت المكبّر لحجمه
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (e.target.closest && e.target.closest('.gadd.sub')) { addingUnder = null; renderGoals(); }
  else if (maxCard && $('#view-goals').classList.contains('active')) setMaxCard(null);
});

function focusAdd(parentId) {
  if (!parentId) return;
  const input = goalCards.querySelector(`.gadd[data-parent="${parentId}"] input`);
  if (input) input.focus();
}

function deleteGoal(g) {
  const subs = descendants(g.id);
  const msg = subs.length
    ? t('confirmDeleteGoalSubs', { title: g.title, n: subs.length })
    : t('confirmDeleteGoal', { title: g.title });
  if (!confirm(msg)) return false;
  const gone = new Set([g.id, ...subs.map(x => x.id)]);
  db.goals = db.goals.filter(x => !gone.has(x.id));
  if (gone.has(addingUnder)) addingUnder = null;
  save();
  renderGoals();
  return true;
}

/* ===================== نافذة الهدف ===================== */
const goalDialog = $('#goalDialog');
const goalForm = $('#goalForm');
let editingGoalId = null;
let editingGoalWasDone = false;

function openGoal(id) {
  const g = db.goals.find(x => x.id === id);
  if (!g) return;
  editingGoalId = id;
  const list = goalsIn(g.type, g.period);
  $('#goalPeriod').textContent = `${t(`goals_${g.type}`)} · ${periodLabel(g.type, periodDate(g.type, g.period))}`;
  goalForm.title.value = g.title;
  goalForm.notes.value = g.notes || '';
  editingGoalWasDone = isGoalDone(g, list);
  goalForm.done.checked = editingGoalWasDone;

  // قائمة "تحت هدف": كل أهداف نفس الفترة ما عدا الهدف نفسه وفروعه
  const sel = goalForm.parent;
  const banned = new Set([g.id, ...descendants(g.id).map(d => d.id)]);
  sel.innerHTML = '';
  sel.add(new Option(t('rootOption'), ''));
  const walk = (pid, depth) => {
    for (const c of childrenOf(list, pid)) {
      if (banned.has(c.id)) continue;
      sel.add(new Option(`${'   '.repeat(depth)}${depth ? '↳ ' : ''}${c.title}`, c.id));
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  sel.value = g.parentId && !banned.has(g.parentId) ? g.parentId : '';
  sel.disabled = false;

  // قائمة "نقل إلى": المعلّقة أو الفترة المعروضة حاليًا في أي كارت
  const move = goalForm.move;
  move.innerHTML = '';
  move.add(new Option(t('moveKeep'), ''));
  for (const type of GOAL_TYPES) {
    const period = periodKey(type, goalRefs[type]);
    if (type === g.type && period === g.period) continue;
    const label = type === 'backlog' ? t('goals_backlog') : `${t(`goals_${type}`)} · ${periodLabel(type, goalRefs[type])}`;
    move.add(new Option(label, `${type}|${period}`));
  }
  move.value = '';

  goalDialog.showModal();
  goalForm.title.focus();
}

goalForm.addEventListener('submit', () => {
  const g = db.goals.find(x => x.id === editingGoalId);
  const title = goalForm.title.value.trim();
  if (!g || !title) return;
  g.title = title;
  g.notes = goalForm.notes.value.trim();
  if (goalForm.done.checked !== editingGoalWasDone) setGoalDone(g, goalForm.done.checked);
  if (goalForm.move.value) {
    // النقل بياخد الهدف بكل فروعه ويحطه هدف رئيسي في المكان الجديد
    const [type, period] = goalForm.move.value.split('|');
    g.parentId = null;
    for (const x of [g, ...descendants(g.id)]) { x.type = type; x.period = period; }
  } else {
    g.parentId = goalForm.parent.value || null;
  }
  if (g.parentId) {
    const p = db.goals.find(x => x.id === g.parentId);
    if (p) p.collapsed = false;
  }
  save();
  renderGoals();
});

// لو اخترت نقل، خانة "تحت هدف" ملهاش لازمة
goalForm.move.addEventListener('change', () => { goalForm.parent.disabled = !!goalForm.move.value; });

$('#goalDelete').addEventListener('click', () => {
  const g = db.goals.find(x => x.id === editingGoalId);
  if (g && deleteGoal(g)) goalDialog.close();
});

// أزرار الإلغاء في النوافذ
document.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => b.closest('dialog').close()));

// الضغط برّه النافذة يقفلها. الضغطة برّه بتوصل للـ dialog نفسه (مش لحاجة جواه).
// بنشترط إن الضغط والإفلات الاتنين برّه، عشان تحديد نص من جوه لبرّه ميقفلهاش.
document.querySelectorAll('dialog').forEach(d => {
  let downOutside = false;
  const outside = e => {
    if (e.target !== d) return false;
    const r = d.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  d.addEventListener('pointerdown', e => { downOutside = outside(e); });
  d.addEventListener('click', e => { if (downOutside && outside(e)) d.close(); downOutside = false; });
});

/* ===================== النسخ الاحتياطي ===================== */
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `organize-it-backup-${ymd(today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#importInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!Array.isArray(d.tasks) || !Array.isArray(d.goals)) throw new Error();
      if (!confirm(t('confirmImport'))) return;
      db = migrate({ tasks: d.tasks, goals: d.goals, events: d.events });
      save();
      renderAll();
    } catch (err) {
      alert(t('invalidFile'));
    }
  };
  reader.readAsText(file);
});

/* ===================== تشغيل ===================== */
function renderAll() { renderTasks(); renderGoals(); }

function applyLang() {
  applyStaticText();
  setupFormatters();
  renderAll();
}

$('#langBtn').addEventListener('click', () => {
  lang = lang === 'ar' ? 'en' : 'ar';
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
  applyLang();
});

// مزامنة لو التطبيق مفتوح في أكثر من تبويب
window.addEventListener('storage', e => {
  if (e.key === STORE_KEY) {
    // تبويب تاني غيّر البيانات: سجل التراجع هنا مبقاش صالح
    db = load();
    lastSaved = JSON.stringify(db);
    undoStack.length = 0;
    updateUndoBtn();
    renderAll();
  }
});

$('#undoBtn').addEventListener('click', undo);
// Ctrl+Z برّه خانات الكتابة
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
  const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]');
  if (typing || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  undo();
});
updateUndoBtn();

let initialView = 'week';
try { initialView = localStorage.getItem(VIEW_KEY) || 'week'; } catch (e) {}
setView(initialView);
applyLang();

// التثبيت على الموبايل: الـ service worker بيخلي التطبيق يفتح من غير إنترنت.
// بيشتغل بس لما الصفحة متفتحة من https أو localhost (مش من file://).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// نطلب من المتصفح ميمسحش بيانات التطبيق لوحده لو المساحة قلت
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
