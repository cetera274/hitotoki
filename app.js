// File: app.js
/**
 * ひととき帳：過ごした時間を、あとから思い出すための記録帳（静的 Web アプリ）。
 * 画面は DOM API で組み立て、ユーザーの入力は textContent として扱います（innerHTML は使いません）。
 */
import * as core from "./core.js";

const { CATEGORIES, CATEGORY_COLORS, FEELINGS, WEEKDAYS } = core;

const PAGES = [
  { key: "record", label: "記録する" },
  { key: "timeline", label: "一日の流れ" },
  { key: "reflect", label: "振り返り" },
  { key: "week", label: "週のようす" },
  { key: "settings", label: "設定" },
];
const PAGE_KEYS = PAGES.map((p) => p.key);
const FEELING_NONE = "選ばない";
const DEL_TARGETS = ["すべての活動記録", "すべての振り返り", "すべてのデータ（記録・振り返り・設定）"];
const NOTIFY_LAST_KEY = `${core.STORAGE_KEY}.notify-last`;
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const GENERIC_ERROR = "データを保存できませんでした。もう一度お試しください。";

// ---------- 保存先 ----------

function openStorage() {
  try {
    const ls = window.localStorage;
    const probe = `${core.STORAGE_KEY}.probe`;
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return { storage: ls, persistent: true };
  } catch {
    return { storage: core.createMemoryStorage(), persistent: false };
  }
}

const { storage, persistent } = openStorage();
const store = new core.Store(storage);

const todayKey = () => core.toDateKey(new Date());

const ui = {
  page: "record",
  form: null,
  formErrors: [],
  viewDay: todayKey(),
  reflectDay: todayKey(),
  weekRef: todayKey(),
  confirmDelete: null,
  confirmReflDel: null,
  confirmReset: false,
  reflectDrafts: {},
  delTarget: DEL_TARGETS[0],
  importResult: null,
  flash: null,
};

function errMessage(err) {
  if (err instanceof core.StorageError || err instanceof core.ValidationError) return err.message;
  return GENERIC_ERROR;
}

function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    console.error(err);
    return { ok: false, message: errMessage(err) };
  }
}

// ---------- DOM ヘルパー ----------

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === "") continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style") Object.assign(el.style, value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (["value", "checked", "disabled", "selected", "open"].includes(key)) el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
}

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  appendChildren(el, children);
  if (props) applyProps(el, props);
  return el;
}

function button(label, onClick, opts = {}) {
  const cls = ["btn"];
  if (opts.primary) cls.push("btn-primary");
  if (opts.danger) cls.push("btn-danger");
  if (opts.cls) cls.push(opts.cls);
  return h("button", {
    type: opts.type || "button",
    class: cls.join(" "),
    id: opts.id,
    disabled: opts.disabled,
    "aria-label": opts.ariaLabel,
    onClick: onClick ? (e) => onClick(e) : undefined,
  }, label);
}

const grid = (n, ...children) => h("div", { class: `grid grid${n}` }, ...children);
const heading = (text) => h("h2", { tabindex: "-1" }, text);
const sub = (text) => h("h3", {}, text);
const note = (text, cls = "") => h("p", { class: `note ${cls}`.trim() }, text);

function message(kind, ...children) {
  return h("div", { class: `msg msg-${kind}`, role: kind === "error" ? "alert" : null }, ...children);
}

function field(label, id, control, ...extra) {
  return h("div", { class: "field" }, h("label", { for: id }, label), control, ...extra);
}

function checkRow(id, label, checked, onChange) {
  return h("label", { class: "check", for: id },
    h("input", { type: "checkbox", id, checked, onChange: (e) => onChange(e.target.checked) }),
    h("span", {}, label));
}

function chipGroup(legend, name, options, selected, onChange, opts = {}) {
  const type = opts.type || "radio";
  const isSelected = (v) => (type === "checkbox" ? selected.includes(v) : selected === v);
  return h("fieldset", { class: "fieldset" },
    h("legend", {}, legend),
    h("div", { class: "chips" }, options.map((value) => {
      const color = opts.colors ? opts.colors[value] : null;
      return h("label", { class: "chip" },
        h("input", {
          type,
          name,
          value,
          checked: isSelected(value),
          onChange: (e) => onChange(value, e.target.checked),
        }),
        h("span", { class: "chip-face" },
          color ? h("span", { "aria-hidden": "true", style: { color } }, "●") : null,
          value));
    })));
}

function metric(label, value) {
  return h("div", { class: "metric" }, h("div", { class: "metric-label" }, label), h("div", { class: "metric-value" }, value));
}

function dataTable(headers, rows, label) {
  return h("div", { class: "table-wrap", role: "region", "aria-label": label, tabindex: "0" },
    h("table", {},
      h("thead", {}, h("tr", {}, headers.map((x) => h("th", { scope: "col" }, x)))),
      h("tbody", {}, rows.map((row) => h("tr", {}, row.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", {}, String(c)))))))));
}

function categoryChip(category) {
  return h("span", { class: "tag" },
    h("span", { "aria-hidden": "true", style: { color: CATEGORY_COLORS[category] || "#7F8791" } }, "●"),
    category);
}

const tag = (text) => h("span", { class: "tag" }, text);

function validDayKey(value) {
  const d = core.parseDateKey(value);
  return d && d.getFullYear() >= 1970 && d.getFullYear() <= 2100 ? d : null;
}

function dateInput(id, value, onPick) {
  const handler = (e) => {
    if (validDayKey(e.target.value)) onPick(e.target.value);
  };
  return h("input", { type: "date", id, value, onChange: handler });
}

function normTime(value) {
  const m = /^(\d{2}):(\d{2})/.exec(String(value || ""));
  return m ? `${m[1]}:${m[2]}` : null;
}

function fmtClock(dt, ref) {
  if (core.sameDay(dt, ref)) return core.toTimeStr(dt);
  const next = core.addDays(core.startOfDay(ref), 1);
  if (dt.getTime() === next.getTime()) return "24:00";
  return `${dt.getMonth() + 1}/${dt.getDate()} ${core.toTimeStr(dt)}`;
}

function fmtRange(start, end, ref = start) {
  return `${fmtClock(start, ref)}〜${fmtClock(end, ref)}`;
}

const durationText = (s, e) => core.fmtMinutes((e - s) / core.MINUTE);
const sum = (values) => values.reduce((a, b) => a + b, 0);

function clippedItems(recs, day) {
  const [lo, hi] = core.dayBounds(day);
  const items = [];
  for (const r of recs) {
    const c = core.clip(r.start, r.end, lo, hi);
    if (c) items.push([r, c]);
  }
  return items;
}

function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function applyFontSize(size) {
  document.documentElement.classList.toggle("large", size === "大きめ");
}

// ---------- お知らせ・描画・画面遷移 ----------

let toastTimer = null;

function showToast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

function flash(kind, text) {
  ui.flash = { kind, text };
}

function renderFlash() {
  const box = document.getElementById("flash");
  box.replaceChildren();
  if (!ui.flash) return;
  box.append(message(ui.flash.kind, ui.flash.text));
  if (ui.flash.kind === "success") showToast(ui.flash.text);
  ui.flash = null;
}

function renderBanner() {
  const box = document.getElementById("banner");
  box.replaceChildren();
  if (!persistent) {
    box.append(message("warning", "このブラウザでは端末内に保存できないため、記録はページを閉じると消えます。"
      + "プライベートブラウズを解除するか、ほかのブラウザでお試しください。"));
  }
  if (store.unreadable) {
    box.append(message("error", "保存領域を読み取れませんでした。ページを再読み込みしてください。"));
  }
  if (store.corruptRaw !== null) {
    const buttons = ui.confirmReset
      ? grid(2,
        button("初期化する", resetCorrupt, { danger: true, id: "reset-yes" }),
        button("やめる", () => {
          ui.confirmReset = false;
          render({ focusId: "reset-ask" });
        }, { id: "reset-no" }))
      : grid(2,
        button("元のデータを書き出す", () => downloadFile(`hitotoki_raw_${todayKey()}.txt`, store.corruptRaw, "text/plain")),
        button("初期化して使い始める", () => {
          ui.confirmReset = true;
          render({ focusId: "reset-no" });
        }, { id: "reset-ask" }));
    box.append(message("error",
      h("p", {}, "保存されていたデータを読み取れませんでした。データを守るため、新しい保存を止めています。"),
      h("p", {}, "元のデータをファイルとして書き出してから、初期化して使い始めることができます。"),
      ui.confirmReset ? h("p", {}, "初期化すると、読み取れなかったデータは消えます。よろしいですか？") : null,
      buttons));
  }
  if (store.dropped > 0) {
    box.append(message("info", `読み取れない記録が${store.dropped}件あったため、表示していません。`));
  }
}

function resetCorrupt() {
  const res = attempt(() => store.deleteEverything());
  ui.confirmReset = false;
  flash(res.ok ? "success" : "error", res.ok ? "初期化しました。ここから新しく記録できます。" : res.message);
  render();
}

function renderTabs() {
  const bar = document.getElementById("tabbar");
  if (!bar.childElementCount) {
    for (const p of PAGES) bar.append(h("a", { class: "tab", href: `#/${p.key}`, dataset: { page: p.key } }, p.label));
  }
  for (const a of bar.children) {
    if (a.dataset.page === ui.page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

const PAGE_RENDERERS = {
  record: pageRecord,
  timeline: pageTimeline,
  reflect: pageReflect,
  week: pageWeek,
  settings: pageSettings,
};

function render(opts = {}) {
  const main = document.getElementById("main");
  main.replaceChildren();
  renderBanner();
  renderTabs();
  const page = PAGES.find((p) => p.key === ui.page) || PAGES[0];
  document.title = `${page.label}｜ひととき帳`;
  try {
    PAGE_RENDERERS[page.key](main);
  } catch (err) {
    console.error(err);
    main.replaceChildren(message("error", "画面を表示できませんでした。ページを再読み込みしてください。"));
  }
  renderFlash();
  if (opts.focusId) {
    const el = document.getElementById(opts.focusId);
    if (el) el.focus({ preventScroll: true });
  } else if (opts.focusHeading) {
    window.scrollTo(0, 0);
    const h2 = main.querySelector("h2");
    if (h2) h2.focus({ preventScroll: true });
  }
}

function pageFromHash() {
  const m = /^#\/([a-z]+)/.exec(location.hash);
  return m && PAGE_KEYS.includes(m[1]) ? m[1] : null;
}

function navigate(page, updates = {}) {
  Object.assign(ui, updates);
  ui.confirmDelete = null;
  ui.confirmReflDel = null;
  const hash = `#/${page}`;
  if (location.hash === hash) {
    ui.page = page;
    render({ focusHeading: true });
  } else {
    location.hash = hash;
  }
}

// ---------- 記録フォーム ----------

function defaultTimes() {
  const end = core.roundDown(new Date(), 5);
  let start = new Date(end.getTime() - 30 * core.MINUTE);
  const last = store.latestEndBefore(end);
  if (last && last.getTime() >= end.getTime() - 6 * core.HOUR && last.getTime() < end.getTime()) start = last;
  return [start, end];
}

function setForm({ name = "", category = null, start = null, end = null, memo = "", feeling = null, editId = null } = {}) {
  const auto = !start || !end;
  if (auto) [start, end] = defaultTimes();
  ui.form = {
    name,
    category: CATEGORIES.includes(category) ? category : null,
    date: core.toDateKey(start),
    start: core.toTimeStr(start),
    end: core.toTimeStr(end),
    nextDay: core.startOfDay(end) > core.startOfDay(start),
    memo,
    feeling: FEELINGS.includes(feeling) ? feeling : null,
    ack: false,
    ackSig: "",
    editId,
    auto,
    createdAt: Date.now(),
  };
  ui.formErrors = [];
}

function refreshAutoTimes(f) {
  if (!f.auto || f.editId || Date.now() - f.createdAt < 5 * core.MINUTE) return;
  const [start, end] = defaultTimes();
  f.date = core.toDateKey(start);
  f.start = core.toTimeStr(start);
  f.end = core.toTimeStr(end);
  f.nextDay = core.startOfDay(end) > core.startOfDay(start);
  f.createdAt = Date.now();
}

function formDatetimes(f) {
  const day = validDayKey(f.date);
  const st = normTime(f.start);
  const et = normTime(f.end);
  if (!day || !st || !et) return [null, null];
  const start = core.parseLocal(`${f.date}T${st}`);
  const endKey = f.nextDay ? core.toDateKey(core.addDays(day, 1)) : f.date;
  const end = core.parseLocal(`${endKey}T${et}`);
  return [start, end];
}

function setEndNow() {
  const f = ui.form;
  const now = core.roundDown(new Date(), 5);
  const d = validDayKey(f.date) || core.startOfDay(now);
  f.end = core.toTimeStr(now);
  if (core.sameDay(now, d)) f.nextDay = false;
  else if (core.sameDay(now, core.addDays(d, 1))) f.nextDay = true;
  f.auto = false;
}

function setDuration(minutes) {
  const f = ui.form;
  let [, end] = formDatetimes(f);
  if (!end) end = core.roundDown(new Date(), 5);
  const start = new Date(end.getTime() - minutes * core.MINUTE);
  f.date = core.toDateKey(start);
  f.start = core.toTimeStr(start);
  f.end = core.toTimeStr(end);
  f.nextDay = !core.sameDay(start, end);
  f.auto = false;
}

function onSave() {
  const f = ui.form;
  const [start, end] = formDatetimes(f);
  const name = f.name.trim();
  const memo = f.memo.trim();
  const errors = core.validateRecord(name, f.category, start, end, memo, f.feeling);
  if (errors.length) {
    ui.formErrors = errors;
    render({ focusId: "f-errors" });
    return;
  }
  const fields = { name, category: f.category, start, end, memo, feeling: f.feeling };
  const res = attempt(() => {
    const overlaps = store.findOverlaps(start, end, f.editId);
    if (overlaps.length && !f.ack) return "overlap";
    if (f.editId) return store.updateRecord(f.editId, fields) ? "saved" : "missing";
    store.addRecord(fields);
    return "saved";
  });
  if (!res.ok || res.value !== "saved") {
    if (res.ok && res.value === "missing") f.editId = null;
    ui.formErrors = [!res.ok ? res.message
      : res.value === "overlap" ? "ほかの記録と時間が重なっています。このまま保存する場合は、確認のチェックを入れてください。"
        : "編集中の記録が見つかりませんでした。すでに削除された可能性があります。"];
    render({ focusId: "f-errors" });
    return;
  }
  const wasEdit = Boolean(f.editId);
  markPresence();
  setForm();
  flash("success", `「${name}」を${wasEdit ? "更新" : "記録"}しました（${fmtRange(start, end)}）。`);
  if (wasEdit) navigate("timeline", { viewDay: core.toDateKey(start) });
  else render({ focusId: "save-btn" });
}

function cancelEdit() {
  setForm();
  flash("info", "編集をやめました。内容は変わっていません。");
  render({ focusHeading: true });
}

function readOngoing(settings) {
  const og = settings.ongoing;
  if (!og || typeof og !== "object") return null;
  const start = core.parseLocal(og.start);
  if (!start || !CATEGORIES.includes(og.category) || !String(og.name || "").trim()) return null;
  return { name: String(og.name), category: og.category, start, memo: String(og.memo || "") };
}

function onStartNow() {
  const f = ui.form;
  const name = f.name.trim();
  const errors = [];
  if (!name) errors.push("始める活動の名前を入力してください。");
  else if (name.length > core.NAME_MAX) errors.push(`活動名は${core.NAME_MAX}文字以内にしてください。`);
  if (!CATEGORIES.includes(f.category)) errors.push("カテゴリを選んでください。");
  if (errors.length) {
    ui.formErrors = errors;
    render({ focusId: "f-errors" });
    return;
  }
  const now = core.floorMinute(new Date());
  const ongoing = { name, category: f.category, start: core.toLocalISO(now), memo: f.memo.trim().slice(0, core.MEMO_MAX) };
  const res = attempt(() => store.setSetting("ongoing", ongoing));
  if (!res.ok) {
    ui.formErrors = [res.message];
    render({ focusId: "f-errors" });
    return;
  }
  setForm();
  flash("success", `「${name}」を始めました。終わったら「終わった（記録する）」を押すと、時間が入ります。`);
  render({ focusId: "og-finish" });
}

function onFinishOngoing() {
  const og = readOngoing(store.getSettings());
  if (!og) {
    flash("info", "進行中の活動は見つかりませんでした。");
    render();
    return;
  }
  const start = og.start;
  let end = core.floorMinute(new Date());
  if (end <= start) end = new Date(start.getTime() + core.MINUTE);
  const errors = core.validateRecord(og.name, og.category, start, end, og.memo, null);
  const overlaps = errors.length ? [] : store.findOverlaps(start, end);
  const review = errors.length > 0 || overlaps.length > 0;
  const res = attempt(() => {
    store.setSetting("ongoing", null);
    if (!review) store.addRecord({ name: og.name, category: og.category, start, end, memo: og.memo });
  });
  if (!res.ok || review) {
    setForm({ name: og.name, category: og.category, start, end, memo: og.memo });
    if (!res.ok) ui.formErrors = [res.message];
    else flash("info", "時間の重なりなど、確認してほしい点があります。内容を見てから保存してください。");
    render({ focusId: res.ok ? "save-btn" : "f-errors" });
    return;
  }
  markPresence();
  flash("success", `「${og.name}」を記録しました（${fmtRange(start, end)}）。`);
  render();
}

function onCancelOngoing() {
  const res = attempt(() => store.setSetting("ongoing", null));
  flash(res.ok ? "info" : "error", res.ok ? "進行中の活動を取り消しました。" : res.message);
  render();
}

function loadForEdit(id) {
  const r = store.getRecord(id);
  if (!r) {
    flash("info", "この記録はすでに削除されていました。");
    render();
    return;
  }
  setForm({ name: r.name, category: r.category, start: r.start, end: r.end, memo: r.memo, feeling: r.feeling, editId: id });
  navigate("record");
}

function openNewWith(start, end) {
  setForm({ start, end });
  navigate("record");
}

function openNewForDay(dayKey) {
  if (dayKey === todayKey()) {
    setForm();
  } else {
    const d = validDayKey(dayKey) || new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0);
    setForm({ start, end: new Date(start.getTime() + 30 * core.MINUTE) });
  }
  navigate("record");
}

function doDelete(id) {
  const res = attempt(() => store.deleteRecord(id));
  ui.confirmDelete = null;
  if (!res.ok) {
    flash("error", res.message);
  } else {
    if (ui.form && ui.form.editId === id) setForm();
    flash(res.value ? "success" : "info", res.value ? "記録を削除しました。" : "この記録はすでに削除されていました。");
  }
  render();
}

function addSamples() {
  const res = attempt(() => store.insertSamples());
  if (!res.ok) flash("error", res.message);
  else if (res.value) flash("success", `架空のサンプルデータを${res.value}件入れました。設定画面からいつでもまとめて削除できます。`);
  else flash("info", "サンプルデータはすでに入っています。");
  render();
}

function removeSamples() {
  const res = attempt(() => store.deleteSamples());
  flash(res.ok ? "success" : "error", res.ok ? "サンプルデータを削除しました。あなたが入れた記録はそのままです。" : res.message);
  render();
}

// ---------- 画面：記録する ----------

function elapsedText(start) {
  const minutes = Math.max(0, (Date.now() - start.getTime()) / core.MINUTE);
  return `${core.toTimeStr(start)}から（${core.fmtMinutes(minutes)}）`;
}

function ongoingCard(og) {
  return h("section", { class: "ongoing", "aria-label": "いま進行中の活動" },
    h("div", { class: "muted" }, "いま進行中"),
    h("div", { class: "card-name" }, og.name),
    h("div", { class: "tags" },
      categoryChip(og.category),
      h("span", { id: "og-elapsed", class: "muted", dataset: { start: core.toLocalISO(og.start) } }, elapsedText(og.start))),
    grid(2,
      button("終わった（記録する）", onFinishOngoing, { primary: true, id: "og-finish" }),
      button("取り消す", onCancelOngoing, { id: "og-cancel" })));
}

function recentBlock(f) {
  const recent = store.recentActivities(6);
  if (!recent.length) return null;
  return h("div", { class: "recent" },
    note("最近の活動から選ぶ（名前とカテゴリが入ります）"),
    grid(2, recent.map(([name, category], i) => button(`${name}（${category}）`, () => {
      f.name = name;
      f.category = category;
      render({ focusId: `recent-${i}` });
    }, { id: `recent-${i}`, cls: "btn-soft" }))));
}

function pageRecord(main) {
  if (!ui.form) setForm();
  const f = ui.form;
  refreshAutoTimes(f);
  const og = readOngoing(store.getSettings());
  const editing = Boolean(f.editId);

  if (editing) {
    main.append(heading("記録を編集"), button("編集をやめる", cancelEdit, { id: "cancel-edit" }));
  } else {
    main.append(heading("過ごした時間を記録"), note("思い出せる範囲で大丈夫です。時刻はあとからいつでも直せます。"));
    if (og) main.append(ongoingCard(og));
    const recent = recentBlock(f);
    if (recent) main.append(recent);
  }

  const preview = h("div", { id: "f-preview", class: "preview", "aria-live": "polite" });
  const saveBtn = button(editing ? "変更を保存する" : "記録する", null, { primary: true, type: "submit", id: "save-btn" });
  const errorsBox = h("div", { id: "f-errors", tabindex: "-1" }, ui.formErrors.map((m) => message("error", m)));
  ui.formErrors = [];

  const refreshPreview = () => {
    preview.replaceChildren();
    const [start, end] = formDatetimes(f);
    let overlaps = [];
    if (start && end && end > start) {
      preview.append(note(`${fmtRange(start, end)}（${durationText(start, end)}）`, "strong"));
      if (end.getTime() > Date.now() + 5 * core.MINUTE) {
        preview.append(message("info", "これから先の時刻が含まれています。予定として残すこともできます。"));
      }
      if (end - start > core.MAX_DURATION_MS) {
        preview.append(message("warning", "24時間を超える記録は、分けて登録してください。"));
      } else {
        overlaps = store.findOverlaps(start, end, f.editId);
      }
    } else if (start && end) {
      preview.append(message("warning", "終了時刻が開始時刻より前になっています。日をまたぐ場合は「翌日に終了」をオンにしてください。"));
    } else {
      preview.append(message("warning", "日付と時刻を入力してください。"));
    }
    const sig = overlaps.map((o) => o.id).join(",");
    if (sig !== f.ackSig) {
      f.ack = false;
      f.ackSig = sig;
    }
    if (overlaps.length) {
      const listed = overlaps.slice(0, 5).map((o) => `${fmtRange(o.start, o.end, start)} ${o.name}`).join("、");
      preview.append(message("warning",
        h("p", {}, `この時間は、ほかの記録と重なっています：${listed}${overlaps.length > 5 ? " ほか" : ""}`),
        checkRow("f-ack", "重なったまま保存する（同時にしていたことなど）", f.ack, (v) => {
          f.ack = v;
          saveBtn.disabled = !v;
        })));
    }
    saveBtn.disabled = overlaps.length > 0 && !f.ack;
  };

  const onTime = (prop) => (e) => {
    f[prop] = e.target.value;
    f.auto = false;
    refreshPreview();
  };
  const memoCount = h("span", { class: "note", "aria-live": "off" }, `${f.memo.length}/${core.MEMO_MAX}文字`);

  const form = h("form", {
    class: "stack",
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      onSave();
    },
  },
  field("活動名", "f-name", h("input", {
    id: "f-name",
    type: "text",
    maxlength: core.NAME_MAX,
    value: f.name,
    autocomplete: "off",
    placeholder: "例：資料づくり、散歩、昼ごはん",
    onInput: (e) => {
      f.name = e.target.value;
    },
    onKeydown: (e) => {
      if (e.key === "Enter") e.preventDefault();
    },
  })),
  chipGroup("カテゴリ", "f-cat", CATEGORIES, f.category, (v) => {
    f.category = v;
  }, { colors: CATEGORY_COLORS }),
  field("日付（始めた日）", "f-date", h("input", { id: "f-date", type: "date", value: f.date, onInput: onTime("date"), onChange: onTime("date") })),
  grid(2,
    field("開始", "f-start", h("input", { id: "f-start", type: "time", step: 300, value: f.start, onInput: onTime("start"), onChange: onTime("start") })),
    field("終了", "f-end", h("input", { id: "f-end", type: "time", step: 300, value: f.end, onInput: onTime("end"), onChange: onTime("end") }))),
  checkRow("f-nextday", "翌日に終了（日をまたぐ）", f.nextDay, (v) => {
    f.nextDay = v;
    f.auto = false;
    refreshPreview();
  }),
  grid(3,
    button("終了を今に", () => {
      setEndNow();
      render({ focusId: "q-now" });
    }, { id: "q-now" }),
    button("30分間にする", () => {
      setDuration(30);
      render({ focusId: "q-30" });
    }, { id: "q-30" }),
    button("1時間にする", () => {
      setDuration(60);
      render({ focusId: "q-60" });
    }, { id: "q-60" })),
  preview,
  chipGroup("体感（任意）", "f-feeling", [FEELING_NONE, ...FEELINGS], f.feeling || FEELING_NONE, (v) => {
    f.feeling = v === FEELING_NONE ? null : v;
  }),
  field("メモ（任意）", "f-memo", h("textarea", {
    id: "f-memo",
    maxlength: core.MEMO_MAX,
    rows: 3,
    value: f.memo,
    placeholder: "あとで思い出す手がかりになることを、ひとことだけでも",
    onInput: (e) => {
      f.memo = e.target.value;
      memoCount.textContent = `${f.memo.length}/${core.MEMO_MAX}文字`;
    },
  }), memoCount),
  errorsBox,
  saveBtn);
  main.append(form);

  if (!editing && !og) {
    main.append(
      button("この名前とカテゴリで、今から始める", onStartNow, { id: "start-now" }),
      note("今から始めて、終わったときに「終わった」を押すと、開始と終了の時刻が自動で入ります。"));
  }
  refreshPreview();
}

// ---------- 画面：一日の流れ ----------

function dayChart(items, day) {
  const [lo, hi] = core.dayBounds(day);
  const span = hi - lo;
  const lanes = core.assignLanes(items.map(([, c]) => c));
  const laneEls = Array.from({ length: Math.max(...lanes) + 1 }, () => h("div", { class: "track" }));
  items.forEach(([r, [cs, ce]], i) => {
    laneEls[lanes[i]].append(h("div", {
      class: "bar",
      title: `${fmtRange(r.start, r.end, day)} ${r.name}（${r.category}）`,
      style: {
        left: `${((cs - lo) / span) * 100}%`,
        width: `${((ce - cs) / span) * 100}%`,
        backgroundColor: CATEGORY_COLORS[r.category],
      },
    }));
  });
  const lanesBox = h("div", { class: "lanes" }, laneEls);
  const now = new Date();
  if (core.sameDay(now, day)) lanesBox.append(h("div", { class: "nowline", style: { left: `${((now - lo) / span) * 100}%` } }));
  const axis = h("div", { class: "axis" }, [0, 3, 6, 9, 12, 15, 18, 21, 24].map((hr) => h("span", {
    class: hr === 0 ? "first" : hr === 24 ? "last" : null,
    style: { left: `${(hr / 24) * 100}%` },
  }, `${hr}時`)));
  const present = CATEGORIES.filter((c) => items.some(([r]) => r.category === c));
  return h("div", { class: "daychart" },
    h("div", { role: "img", "aria-label": `${core.formatDay(day)}の記録を24時間の帯で表した図。${items.length}件。くわしくは下の一覧をご覧ください。` },
      lanesBox, axis),
    h("div", { class: "legend" }, present.map(categoryChip)));
}

function categoryBreakdown(items) {
  const totals = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const [r, [cs, ce]] of items) totals[r.category] += (ce - cs) / core.MINUTE;
  const chips = CATEGORIES.filter((c) => totals[c] > 0).map((c) => h("span", { class: "tags" }, categoryChip(c), h("span", { class: "muted" }, core.fmtMinutes(totals[c]))));
  return h("div", { class: "legend", "aria-label": "カテゴリごとの時間" }, chips);
}

function recordCard(r, ref) {
  return h("article", { class: "card", style: { borderLeftColor: CATEGORY_COLORS[r.category] } },
    h("div", { class: "card-time" }, fmtRange(r.start, r.end, ref), " ", h("span", { class: "muted" }, `（${durationText(r.start, r.end)}）`)),
    h("div", { class: "card-name" }, r.name),
    h("div", { class: "tags" }, categoryChip(r.category), r.feeling ? tag(r.feeling) : null, r.is_sample ? tag("サンプル") : null),
    r.memo ? h("div", { class: "card-memo" }, r.memo) : null);
}

function recordLine(r, ref) {
  return h("div", { class: "line" },
    h("span", { class: "card-time" }, fmtRange(r.start, r.end, ref)),
    `${r.name} `,
    categoryChip(r.category),
    r.feeling ? h("span", { class: "muted" }, ` ・${r.feeling}`) : null);
}

function recordItem(r, day) {
  const wrap = h("div", { class: "record" }, recordCard(r, day));
  if (ui.confirmDelete === r.id) {
    wrap.append(
      message("warning", "この記録を削除しますか？元に戻すことはできません。"),
      grid(2,
        button("削除する", () => doDelete(r.id), { danger: true, id: `del-yes-${r.id}` }),
        button("やめる", () => {
          ui.confirmDelete = null;
          render({ focusId: `del-${r.id}` });
        }, { id: `del-no-${r.id}` })));
  } else {
    wrap.append(grid(2,
      button("編集", () => loadForEdit(r.id), { id: `edit-${r.id}`, ariaLabel: `「${r.name}」を編集` }),
      button("削除", () => {
        ui.confirmDelete = r.id;
        render({ focusId: `del-no-${r.id}` });
      }, { id: `del-${r.id}`, ariaLabel: `「${r.name}」を削除` })));
  }
  return wrap;
}

function emptyDay(main, dayKey) {
  main.append(
    h("div", { class: "empty" },
      "この日の記録は、まだありません。", h("br"),
      "思い出せる時間がひとつあれば、そこから書いてみませんか。", h("br"),
      "どんなに小さなことでも大丈夫です。"),
    button("この日の時間を記録する", () => openNewForDay(dayKey), { primary: true, id: "empty-add" }));
  if (store.countRecords() === 0) {
    main.append(
      button("サンプルデータで試してみる", addSamples, { id: "empty-sample" }),
      note("サンプルは架空の内容で、あとからまとめて削除できます。"));
  }
}

function pageTimeline(main) {
  const settings = store.getSettings();
  const day = validDayKey(ui.viewDay) || core.startOfDay(new Date());
  const dayKey = core.toDateKey(day);
  const isToday = dayKey === todayKey();
  const shiftDay = (n, id) => () => {
    ui.viewDay = core.toDateKey(core.addDays(day, n));
    ui.confirmDelete = null;
    render({ focusId: id });
  };

  main.append(
    heading(`${core.formatDay(day)}${isToday ? "（今日）" : ""}`),
    grid(3,
      button("← 前の日", shiftDay(-1, "tl-prev"), { id: "tl-prev" }),
      button("今日", () => {
        ui.viewDay = todayKey();
        render({ focusId: "tl-today" });
      }, { id: "tl-today" }),
      button("次の日 →", shiftDay(1, "tl-next"), { id: "tl-next" })),
    field("表示する日", "tl-date", dateInput("tl-date", dayKey, (v) => {
      ui.viewDay = v;
      render({ focusId: "tl-date" });
    })));

  const [lo, hi] = core.dayBounds(day);
  const recs = store.recordsBetween(lo, hi);
  if (!recs.length) {
    emptyDay(main, dayKey);
    return;
  }
  const items = clippedItems(recs, day);
  main.append(
    h("div", { class: "metrics" },
      metric("記録した時間", core.fmtMinutes(core.unionMinutes(items.map(([, c]) => c)))),
      metric("記録の数", `${recs.length}件`)),
    dayChart(items, day),
    note("色のついた部分が記録した時間です。色のない部分は、まだ書いていない時間です。"
      + "重なる記録は段を分けて表示しています。点線は今の時刻です。"),
    categoryBreakdown(items),
    sub("時間の流れ"));

  const gaps = settings.show_gap_add ? core.findGaps(items.map(([, c]) => c), 30) : [];
  const gapByEnd = new Map(gaps.map((g) => [g[1].getTime(), g]));
  const shown = new Set();
  for (const [r, [cs]] of items) {
    const gap = gapByEnd.get(cs.getTime());
    if (gap && !shown.has(gap)) {
      shown.add(gap);
      main.append(button(`＋ ${fmtRange(gap[0], gap[1], day)} の時間を追加`, () => openNewWith(gap[0], gap[1]), { cls: "btn-gap" }));
    }
    main.append(recordItem(r, day));
  }

  main.append(
    h("hr", { class: "divider" }),
    grid(2,
      button("この日の時間を追加", () => openNewForDay(dayKey), { id: "tl-add" }),
      button("この日を振り返る", () => navigate("reflect", { reflectDay: dayKey }), { primary: true, id: "tl-reflect" })));
}

// ---------- 画面：振り返り ----------

function saveReflectionFor(dayKey) {
  const existing = store.getReflection(dayKey);
  const draft = ui.reflectDrafts[dayKey] || {};
  const answers = { ...existing };
  for (const [qk] of core.REFLECTION_QUESTIONS) answers[qk] = draft[qk] ?? existing[qk] ?? "";
  const res = attempt(() => store.saveReflection(dayKey, answers));
  if (!res.ok) {
    flash("error", res.message);
    render();
    return;
  }
  delete ui.reflectDrafts[dayKey];
  if (res.value) flash("success", "振り返りを保存しました。");
  else if (Object.keys(existing).length) flash("info", "すべて空欄になったため、この日の振り返りは削除しました。");
  else flash("info", "空欄のため、保存する内容はありませんでした。それでも大丈夫です。");
  render({ focusId: "rf-save" });
}

function deleteReflectionFor(dayKey) {
  const res = attempt(() => store.deleteReflection(dayKey));
  ui.confirmReflDel = null;
  delete ui.reflectDrafts[dayKey];
  flash(res.ok ? "success" : "error", res.ok ? "この日の振り返りを削除しました。" : res.message);
  render();
}

function pageReflect(main) {
  const day = validDayKey(ui.reflectDay) || core.startOfDay(new Date());
  const dayKey = core.toDateKey(day);
  main.append(
    heading("振り返り"),
    note("答えたい問いにだけ、答えたいときに。空欄のままでも、スキップしても大丈夫です。"),
    field("振り返る日", "rf-date", dateInput("rf-date", dayKey, (v) => {
      ui.reflectDay = v;
      ui.confirmReflDel = null;
      render({ focusId: "rf-date" });
    })));

  const [lo, hi] = core.dayBounds(day);
  const recs = store.recordsBetween(lo, hi);
  const existing = store.getReflection(dayKey);

  main.append(h("details", { open: true },
    h("summary", {}, `${core.formatDay(day)}の記録（${recs.length}件）`),
    recs.length ? recs.map((r) => recordLine(r, day))
      : h("p", {}, "この日の記録はまだありません。記録がなくても、思い出したことをここに書き残せます。")));

  const felt = (label) => recs.filter((r) => r.feeling === label).map((r) => r.name);
  const longs = felt("長く感じた");
  const shorts = felt("短く感じた");
  if (longs.length) main.append(note(`記録のときに「長く感じた」と選んだ時間：${longs.join("、")}`));
  if (shorts.length) main.append(note(`記録のときに「短く感じた」と選んだ時間：${shorts.join("、")}`));

  const draft = ui.reflectDrafts[dayKey] || (ui.reflectDrafts[dayKey] = {});
  const form = h("form", {
    class: "stack",
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      saveReflectionFor(dayKey);
    },
  },
  core.REFLECTION_QUESTIONS.map(([qk, question]) => field(question, `rf-${qk}`, h("textarea", {
    id: `rf-${qk}`,
    maxlength: core.ANSWER_MAX,
    rows: 3,
    value: draft[qk] ?? existing[qk] ?? "",
    onInput: (e) => {
      draft[qk] = e.target.value;
    },
  }))),
  button("保存する", null, { primary: true, type: "submit", id: "rf-save" }));
  main.append(form);

  main.append(button("スキップする", () => {
    flash("info", "振り返りは、いつでも好きなときにできます。");
    navigate("timeline", { viewDay: dayKey });
  }, { id: "rf-skip" }));

  if (Object.keys(existing).length) {
    if (ui.confirmReflDel === dayKey) {
      main.append(
        message("warning", "この日の振り返りを削除しますか？元に戻すことはできません。"),
        grid(2,
          button("削除する", () => deleteReflectionFor(dayKey), { danger: true, id: "rf-del-yes" }),
          button("やめる", () => {
            ui.confirmReflDel = null;
            render({ focusId: "rf-del" });
          }, { id: "rf-del-no" })));
    } else {
      main.append(button("この日の振り返りを削除", () => {
        ui.confirmReflDel = dayKey;
        render({ focusId: "rf-del-no" });
      }, { id: "rf-del" }));
    }
  }
}

// ---------- 画面：週のようす ----------

function categoryPivot(recs, days) {
  const table = {};
  for (const d of days) table[core.toDateKey(d)] = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const row of core.dailyCategoryMinutes(recs, days)) table[row.day][row.category] += row.minutes;
  return table;
}

function hoursShort(minutes) {
  const v = Math.round((minutes / 60) * 10) / 10;
  return `${v}h`;
}

function weekChart(pivot, days) {
  const keys = days.map(core.toDateKey);
  const totals = keys.map((k) => sum(CATEGORIES.map((c) => pivot[k][c])));
  const max = Math.max(...totals, 60);
  const cols = days.map((d, i) => {
    const k = keys[i];
    const segs = CATEGORIES.filter((c) => pivot[k][c] > 0).map((c) => h("div", {
      class: "wseg",
      title: `${core.formatDay(d)} ${c}：${core.fmtMinutes(pivot[k][c])}`,
      style: { height: `${(pivot[k][c] / max) * 100}%`, backgroundColor: CATEGORY_COLORS[c] },
    }));
    return h("div", { class: "wcol" },
      h("div", { class: "wtotal" }, totals[i] > 0 ? hoursShort(totals[i]) : ""),
      h("div", { class: "wstack" }, segs),
      h("div", { class: "wlabel" }, `${d.getMonth() + 1}/${d.getDate()}`, h("br"), WEEKDAYS[core.mondayIndex(d)]));
  });
  const present = CATEGORIES.filter((c) => keys.some((k) => pivot[k][c] > 0));
  return h("div", {},
    h("div", { class: "wchart", role: "img", "aria-label": "日ごとのカテゴリ別の時間を積み上げた図。数値は下の表をご覧ください。" }, cols),
    h("div", { class: "legend" }, present.map(categoryChip)),
    note("棒の上の数字は、その日のカテゴリ別の時間の合計（h＝時間）です。"));
}

function heatColor(t) {
  if (t <= 0) return "#F1EEE8";
  const a = [0xDD, 0xEC, 0xEA];
  const b = [0x1F, 0x57, 0x52];
  const k = Math.min(1, Math.max(0, t)) ** 0.8;
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function heatmap(hourly) {
  const cats = CATEGORIES.filter((c) => hourly.some((x) => x.category === c));
  const map = new Map(hourly.map((x) => [`${x.hour}|${x.category}`, x.minutes]));
  const max = Math.max(...hourly.map((x) => x.minutes));
  const cells = [h("div", { class: "hhead" }, "")];
  for (let hr = 0; hr < 24; hr += 1) cells.push(h("div", { class: "hhead" }, hr % 3 === 0 ? String(hr) : ""));
  for (const cat of cats) {
    cells.push(h("div", { class: "hlabel" }, cat));
    for (let hr = 0; hr < 24; hr += 1) {
      const m = map.get(`${hr}|${cat}`) || 0;
      cells.push(h("div", { class: "hcell", title: `${cat} ${hr}時台：${core.fmtMinutes(m)}`, style: { backgroundColor: heatColor(m / max) } }));
    }
  }
  return h("div", {},
    h("div", { class: "heat", role: "img", "aria-label": "時間帯ごと・カテゴリごとの記録の多さを色の濃さで表した図。" }, cells),
    h("div", { class: "heat-legend", "aria-hidden": "true" },
      "少ない",
      [0.15, 0.4, 0.7, 1].map((t) => h("span", { class: "sw", style: { backgroundColor: heatColor(t) } })),
      "多い"),
    note("横軸は時刻（時）です。色が濃いほど、その時間帯にそのカテゴリの記録が多かったことを表します。"));
}

function weekStats(main, recs, days, lo) {
  const keys = days.map(core.toDateKey);
  const union = core.dailyUnionMinutes(recs, days);
  const recordedKeys = keys.filter((k) => union[k] > 0);
  const medDay = recordedKeys.length ? core.median(recordedKeys.map((k) => union[k])) : 0;
  main.append(h("div", { class: "metrics" },
    metric("記録のあった日", `${recordedKeys.length}日`),
    metric("記録した時間", core.fmtMinutes(sum(keys.map((k) => union[k])))),
    metric("1日あたり（中央値）", core.fmtMinutes(medDay))));

  const pivot = categoryPivot(recs, days);
  main.append(sub("日ごとのカテゴリ"), weekChart(pivot, days));

  const rows = [];
  for (const cat of CATEGORIES) {
    const vals = keys.map((k) => pivot[k][cat]);
    const active = vals.filter((v) => v > 0);
    if (!active.length) continue;
    rows.push([cat, core.fmtMinutes(sum(vals)), `${active.length}日`, core.fmtMinutes(core.median(active)),
      `${core.fmtMinutes(Math.min(...active))}〜${core.fmtMinutes(Math.max(...active))}`]);
  }
  main.append(
    sub("カテゴリ別のまとめ"),
    dataTable(["カテゴリ", "合計", "記録のあった日", "1日あたり（中央値）", "幅（最小〜最大）"], rows, "カテゴリ別のまとめ"),
    note("中央値は、そのカテゴリの記録があった日の真ん中の値で、極端に長い日があっても影響を受けにくい代表値です。"
      + "並び順はカテゴリの順で、多い・少ないの順位ではありません。重なっている記録は、それぞれの時間として数えています。"));

  const hourly = core.hourlyCategoryMinutes(recs, lo, core.addDays(lo, 7));
  if (hourly.length) main.append(sub("時間帯ごとのようす（週の合計）"), heatmap(hourly));

  const felt = recs.filter((r) => FEELINGS.includes(r.feeling));
  if (felt.length) {
    const cats = CATEGORIES.filter((c) => felt.some((r) => r.category === c));
    const feltRows = cats.map((c) => [c, ...FEELINGS.map((fe) => felt.filter((r) => r.category === c && r.feeling === fe).length)]);
    main.append(sub("体感のメモ"), dataTable(["カテゴリ", ...FEELINGS], feltRows, "体感の件数"),
      note("記録のときに任意で選んだ「体感」の件数です。"));
  }

  main.append(sub("これまでの4週と比べて"));
  const baseLo = core.addDays(lo, -28);
  const baseRecs = store.recordsBetween(baseLo, lo);
  const baseDays = Array.from({ length: 28 }, (_, i) => core.addDays(baseLo, i));
  const baseUnion = core.dailyUnionMinutes(baseRecs, baseDays);
  const baseRecorded = baseDays.filter((d) => baseUnion[core.toDateKey(d)] > 0);
  if (baseRecorded.length >= 7 && recordedKeys.length >= 3) {
    const basePivot = categoryPivot(baseRecs, baseRecorded);
    const baseKeys = baseRecorded.map(core.toDateKey);
    const comp = [];
    for (const cat of CATEGORIES) {
      const b = baseKeys.map((k) => basePivot[k][cat]);
      const w = recordedKeys.map((k) => pivot[k][cat]);
      if (sum(b) === 0 && sum(w) === 0) continue;
      const q1 = core.quantile(b, 0.25);
      const med = core.quantile(b, 0.5);
      const q3 = core.quantile(b, 0.75);
      const wm = core.median(w);
      const label = wm > q3 ? "ふだんより長め" : wm < q1 ? "ふだんより短め" : "ふだんの幅の中";
      comp.push([cat, core.fmtMinutes(wm), core.fmtMinutes(med), `${core.fmtMinutes(q1)}〜${core.fmtMinutes(q3)}`, label]);
    }
    main.append(
      dataTable(["カテゴリ", "今週（中央値/日）", "これまで（中央値/日）", "ふだんの幅（Q1〜Q3）", "ようす"], comp, "これまでの4週との比較"),
      note(`記録のあった日（今週${recordedKeys.length}日、これまでの4週${baseRecorded.length}日）だけで比べています。`
        + "ふだんの幅（四分位範囲）は、記録のあった日の真ん中半分が収まる範囲です。"
        + "記録した時間だけをもとにしているため、実際の過ごし方の全体を表すものではありません。"));
  } else {
    main.append(message("info", "比べるには、もう少し記録のある日が必要です（これまでの4週で7日以上、今週3日以上）。"
      + "比べなくても、上のグラフで今週のようすを見ることができます。"));
  }
}

function weekDays(main, days, recs, refls) {
  main.append(sub("日ごとの記録"));
  let shown = 0;
  for (const d of days) {
    const key = core.toDateKey(d);
    const items = clippedItems(recs, d);
    const refl = refls[key];
    if (!items.length && !refl) continue;
    shown += 1;
    let label = `${core.formatDay(d)}　${items.length}件`;
    if (items.length) label += `・${core.fmtMinutes(core.unionMinutes(items.map(([, c]) => c)))}`;
    if (refl) label += "・振り返りあり";
    const answers = refl
      ? core.REFLECTION_QUESTIONS.filter(([qk]) => refl[qk]).map(([qk, q]) => [h("div", { class: "answer-q" }, q), h("div", { class: "answer-a" }, refl[qk])])
      : [];
    main.append(h("details", {},
      h("summary", {}, label),
      items.map(([r]) => recordLine(r, d)),
      answers,
      grid(2,
        button("一日の流れを開く", () => navigate("timeline", { viewDay: key })),
        button("振り返る", () => navigate("reflect", { reflectDay: key })))));
  }
  if (!shown) main.append(note("この週の日ごとの記録はありません。"));
}

function pageWeek(main) {
  const ref = validDayKey(ui.weekRef) || core.startOfDay(new Date());
  const ws = core.weekStart(ref);
  const days = Array.from({ length: 7 }, (_, i) => core.addDays(ws, i));
  const shiftWeek = (n, id) => () => {
    ui.weekRef = core.toDateKey(core.addDays(ref, n));
    render({ focusId: id });
  };
  main.append(
    heading(`${core.formatDay(days[0])}〜${core.formatDay(days[6])}`),
    grid(3,
      button("← 前の週", shiftWeek(-7, "wk-prev"), { id: "wk-prev" }),
      button("今週", () => {
        ui.weekRef = todayKey();
        render({ focusId: "wk-now" });
      }, { id: "wk-now" }),
      button("次の週 →", shiftWeek(7, "wk-next"), { id: "wk-next" })),
    field("この日を含む週を表示", "wk-date", dateInput("wk-date", core.toDateKey(ref), (v) => {
      ui.weekRef = v;
      render({ focusId: "wk-date" });
    })));

  const lo = ws;
  const hi = core.addDays(ws, 7);
  const recs = store.recordsBetween(lo, hi);
  const refls = store.reflectionsBetween(core.toDateKey(days[0]), core.toDateKey(days[6]));
  if (!recs.length && !Object.keys(refls).length) {
    main.append(
      h("div", { class: "empty" }, "この週の記録は、まだありません。", h("br"), "記録が少しずつ増えると、ここに週のようすが表れます。"),
      button("今日の時間を記録する", () => openNewForDay(todayKey()), { primary: true, id: "wk-empty-add" }));
    if (store.countRecords() === 0) main.append(button("サンプルデータで試してみる", addSamples, { id: "wk-empty-sample" }));
    return;
  }
  if (recs.length) weekStats(main, recs, days, lo);
  weekDays(main, days, recs, refls);
}

// ---------- 通知（ページを開いている間だけ動く試験的な機能） ----------

let lastPresenceMs = Date.now();

function markPresence() {
  lastPresenceMs = Date.now();
}

function readNotifyLast() {
  try {
    const v = Number(storage.getItem(NOTIFY_LAST_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function writeNotifyLast(ms) {
  try {
    storage.setItem(NOTIFY_LAST_KEY, String(ms));
  } catch {
    // 保存できなくても通知の動作には影響しない
  }
}

const notifySupported = () => "Notification" in window;

async function showReminder() {
  const title = "ひととき帳";
  const options = {
    body: "さっきまでの時間を、ひとことだけ残してみませんか。いつでもスキップできます。",
    tag: "hitotoki-reminder",
    icon: "./icon.svg",
    lang: "ja",
  };
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  }
  const n = new Notification(title, options);
  n.onclick = () => {
    window.focus();
    navigate("record");
    n.close();
  };
}

async function checkReminder() {
  if (document.hasFocus()) {
    markPresence();
    return;
  }
  const settings = store.getSettings();
  if (!settings.notify_enabled || !notifySupported() || Notification.permission !== "granted") return;
  const last = Math.max(readNotifyLast(), lastPresenceMs);
  if (!core.notifyDue(settings, new Date(), last)) return;
  try {
    await showReminder();
    writeNotifyLast(Date.now());
  } catch (err) {
    console.error(err);
  }
}

async function onSaveNotify(form) {
  const enabled = form.querySelector("#n-enabled").checked;
  const frequency = form.querySelector("#n-freq").value;
  const qs = normTime(form.querySelector("#n-qs").value);
  const qe = normTime(form.querySelector("#n-qe").value);
  const days = [...form.querySelectorAll('input[name="n-day"]:checked')].map((i) => i.value);
  const errBox = form.querySelector("#n-errors");
  errBox.replaceChildren();
  const fail = (text) => {
    errBox.append(message("error", text));
    errBox.focus({ preventScroll: true });
  };
  if (enabled && !days.length) {
    fail("通知する曜日を1つ以上選んでください。");
    return;
  }
  if (!qs || !qe) {
    fail("「通知しない時間」を入力してください。");
    return;
  }
  let finalEnabled = enabled;
  let extra = "";
  if (enabled) {
    if (!notifySupported()) {
      finalEnabled = false;
      extra = "このブラウザでは通知を使えないため、オフのまま保存しました。";
    } else if (Notification.permission !== "granted") {
      let permission = "denied";
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = "denied";
      }
      if (permission !== "granted") {
        finalEnabled = false;
        extra = "通知が許可されなかったため、オフのまま保存しました。許可はブラウザの設定から変更できます。";
      }
    }
  }
  const res = attempt(() => store.setSettings({
    notify_enabled: finalEnabled,
    notify_frequency: core.NOTIFY_FREQUENCIES.includes(frequency) ? frequency : "2時間ごと",
    notify_quiet_start: qs,
    notify_quiet_end: qe,
    notify_days: WEEKDAYS.filter((d) => days.includes(d)),
  }));
  if (!res.ok) {
    fail(res.message);
    return;
  }
  writeNotifyLast(Date.now());
  let text = `通知の設定を保存しました。${extra}`;
  if (qs === qe) text += "「通知しない時間」の開始と終了が同じため、通知しない時間帯はない設定です。";
  flash(extra ? "info" : "success", text);
  render({ focusId: "n-save" });
}

// ---------- 画面：設定 ----------

function saveSetting(key, value, after) {
  const res = attempt(() => store.setSetting(key, value));
  if (!res.ok) {
    flash("error", res.message);
    render();
    return;
  }
  if (after) after();
}

function doBulkDelete() {
  const target = ui.delTarget;
  const res = attempt(() => {
    if (target === DEL_TARGETS[0]) {
      store.deleteAllRecords();
      return "すべての活動記録を削除しました。";
    }
    if (target === DEL_TARGETS[1]) {
      store.deleteAllReflections();
      ui.reflectDrafts = {};
      return "すべての振り返りを削除しました。";
    }
    store.deleteEverything();
    try {
      storage.removeItem(NOTIFY_LAST_KEY);
    } catch {
      // 通知の時刻だけの情報のため、消せなくても問題ありません
    }
    ui.reflectDrafts = {};
    applyFontSize("標準");
    return "すべてのデータを削除しました。設定も初期状態に戻りました。";
  });
  ui.confirmDelete = null;
  ui.form = null;
  flash(res.ok ? "success" : "error", res.ok ? res.value : res.message);
  render();
}

async function importFile(fileInput) {
  const file = fileInput.files && fileInput.files[0];
  const done = (result) => {
    ui.importResult = result;
    render({ focusId: "import-result" });
  };
  if (!file) {
    done({ error: "ファイルを選んでください。" });
    return;
  }
  if (file.size > IMPORT_MAX_BYTES) {
    done({ error: "ファイルが大きすぎます（5MBまで）。" });
    return;
  }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    done({ error: "ファイルを読み取れませんでした。JSON形式のファイルか確認してください。" });
    return;
  }
  const res = attempt(() => store.importDict(data));
  if (!res.ok) {
    done({ error: res.message });
    return;
  }
  const r = res.value;
  flash("success", `記録を${r.added}件、振り返りを${r.reflections}件読み込みました。（すでにある記録${r.skipped}件はそのままにしました）`);
  done(r);
}

function persistBlock() {
  if (!navigator.storage || typeof navigator.storage.persist !== "function") return null;
  const status = note("確認しています…");
  navigator.storage.persisted()
    .then((p) => {
      status.textContent = p
        ? "このブラウザに、保存データを残すよう設定されています。"
        : "ブラウザの空き容量が少なくなったときなどに、保存データが消されることがあります。";
    })
    .catch(() => {
      status.textContent = "";
    });
  return h("div", {}, status, button("保存データを消されにくくする", async () => {
    let ok = false;
    try {
      ok = await navigator.storage.persist();
    } catch {
      ok = false;
    }
    flash(ok ? "success" : "info", ok ? "保存データを残すよう、ブラウザに設定しました。"
      : "ブラウザの判断で、受け付けられませんでした。定期的なバックアップ（JSONの書き出し）をおすすめします。");
    render();
  }, { id: "persist-btn" }));
}

function pageSettings(main) {
  const s = store.getSettings();
  main.append(heading("設定"));

  main.append(
    sub("表示"),
    chipGroup("文字の大きさ", "s-font", ["標準", "大きめ"], s.font_size, (v) => saveSetting("font_size", v, () => applyFontSize(v))),
    checkRow("s-gap", "一日の流れで、記録と記録のあいだに「＋ 追加」ボタンを出す", Boolean(s.show_gap_add), (v) => saveSetting("show_gap_add", v)));

  main.append(sub("記録のお知らせ（通知）"));
  main.append(message("info",
    h("p", {}, "試験的な機能です。このページ（またはホーム画面に追加したアプリ）を開いている間だけ、設定した間隔でお知らせします。"
      + "ページを閉じている間や、ブラウザが止めている間は届きません。初期状態はオフです。"),
    h("p", {}, "通知には記録の内容を含めません。このアプリを使っている間（画面を操作している間）は、お知らせしません。")));
  if (!notifySupported()) {
    main.append(message("warning", "このブラウザでは通知を使えません。設定は保存できます。"));
  } else {
    const p = Notification.permission;
    main.append(note(`ブラウザの通知の許可：${p === "granted" ? "許可済み" : p === "denied" ? "拒否されています（ブラウザの設定から変更できます）" : "まだ確認していません"}`));
  }
  const notifyForm = h("form", {
    class: "stack",
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      onSaveNotify(e.currentTarget);
    },
  },
  checkRow("n-enabled", "記録のお知らせを受け取る", Boolean(s.notify_enabled), () => {}),
  field("頻度", "n-freq", h("select", { id: "n-freq" }, core.NOTIFY_FREQUENCIES.map((fr) => h("option", { value: fr, selected: fr === s.notify_frequency }, fr)))),
  note("「1日1回（夜）」は、21時以降に一度だけお知らせします（通知しない時間を除く）。"),
  grid(2,
    field("通知しない時間（から）", "n-qs", h("input", { id: "n-qs", type: "time", step: 1800, value: normTime(s.notify_quiet_start) || "22:00" })),
    field("通知しない時間（まで）", "n-qe", h("input", { id: "n-qe", type: "time", step: 1800, value: normTime(s.notify_quiet_end) || "08:00" }))),
  chipGroup("通知する曜日", "n-day", WEEKDAYS, Array.isArray(s.notify_days) ? s.notify_days : [], () => {}, { type: "checkbox" }),
  h("div", { id: "n-errors", tabindex: "-1" }),
  button("通知の設定を保存する", null, { type: "submit", primary: true, id: "n-save" }));
  main.append(notifyForm, button("テスト通知を送る", async () => {
    if (!notifySupported() || Notification.permission !== "granted") {
      flash("info", "通知が許可されていません。「記録のお知らせを受け取る」をオンにして保存すると、許可を確認します。");
      render();
      return;
    }
    try {
      await showReminder();
      flash("success", "テスト通知を送りました。");
    } catch {
      flash("error", "通知を表示できませんでした。ブラウザや端末の通知設定をご確認ください。");
    }
    render({ focusId: "n-test" });
  }, { id: "n-test" }));

  main.append(sub("プライバシーとデータ"));
  main.append(
    h("p", {}, "活動記録はセンシティブな個人情報として扱います。記録は、このブラウザの保存領域（localStorage、端末の中）にだけ保存されます。"
      + "アプリが記録内容をどこかへ送信することはありません。外部への通信と外部ファイルの読み込みは、"
      + "Content-Security-Policy によりブラウザ側でも禁止しています。"),
    note("保存しているもの：活動名、カテゴリ、開始・終了時刻、メモ、体感、振り返りの回答、表示と通知の設定"),
    note("このページを開くときは、公開しているサーバー（GitHub Pages の場合は GitHub）からアプリのファイルを読み込みます。"
      + "そのときサーバー側にアクセスの記録（IPアドレスなど）が残る場合がありますが、記録内容は含まれません。"),
    note("保存先（オリジン）"),
    h("p", { class: "mono" }, `${location.origin}　キー：${core.STORAGE_KEY}`));
  if (location.hostname.endsWith(".github.io")) {
    main.append(message("warning", "「〜.github.io」で公開されているため、同じアカウントで公開しているほかの GitHub Pages のページと、"
      + "保存領域が共有されます。そちらのページの JavaScript からも、この記録を読み取れる状態です。"
      + "心配な場合は、このアプリ専用のアカウントや独自ドメインで公開するか、手元のパソコンで起動して使ってください（README参照）。"));
  }
  const raw = store.rawText();
  main.append(
    note(`保存データの大きさ：約${Math.max(1, Math.ceil(new TextEncoder().encode(raw).length / 1024))}KB`),
    note("ブラウザの「閲覧データの削除」などを行うと、記録も消えます。端末を共有している場合は、ほかの人にも見える点にご注意ください。"));
  const persistEl = persistBlock();
  if (persistEl) main.append(persistEl);

  const records = store.allRecords();
  main.append(
    grid(2,
      button("CSVで書き出す", () => downloadFile(`hitotoki_${todayKey()}.csv`, core.recordsToCSV(records), "text/csv"), { disabled: !records.length, id: "dl-csv" }),
      button("JSONで書き出す（バックアップ）", () => downloadFile(`hitotoki_${todayKey()}.json`, JSON.stringify(store.exportDict(), null, 2), "application/json"), { id: "dl-json" })),
    note("書き出したファイルには記録内容がそのまま含まれます。保管場所や共有にご注意ください。"));

  const fileInput = h("input", { type: "file", id: "import-file", accept: ".json,application/json" });
  const result = ui.importResult;
  ui.importResult = null;
  main.append(h("details", { open: Boolean(result) },
    h("summary", {}, "バックアップ（JSON）から読み込む"),
    note("ひととき帳（Streamlit版を含む）で書き出したJSONファイルを読み込めます。すでにある記録は上書きしません。"),
    field("ファイルを選ぶ", "import-file", fileInput),
    button("このファイルを読み込む", () => importFile(fileInput), { id: "import-btn" }),
    h("div", { id: "import-result", tabindex: "-1" },
      result && result.error ? message("error", result.error) : null,
      result && result.problems ? result.problems.slice(0, 20).map((p) => note(p)) : null)));

  main.append(sub("サンプルデータ"));
  main.append(store.hasSamples()
    ? button("サンプルデータを削除する", removeSamples, { id: "sample-del" })
    : button("サンプルデータを入れる", addSamples, { id: "sample-add" }));
  main.append(note("サンプルは架空の内容です。あなたの記録とは区別され、いつでもまとめて削除できます。"));

  main.append(sub("データの削除"));
  const delBtn = button("削除する", doBulkDelete, { danger: true, id: "del-btn", disabled: true });
  main.append(
    chipGroup("削除するもの", "del-target", DEL_TARGETS, ui.delTarget, (v) => {
      ui.delTarget = v;
    }),
    checkRow("del-confirm", "元に戻せないことを確認しました", false, (v) => {
      delBtn.disabled = !v;
    }),
    delBtn,
    note("削除した内容は、このブラウザの保存領域から取り除かれます。書き出したファイルは、ご自身で削除してください。"));

  main.append(h("details", {},
    h("summary", {}, "このアプリについて"),
    h("p", {}, "ひととき帳は、時間を細かく管理するためではなく、過ごした時間をあとから思い出すための記録帳です。"
      + "記録を続けることや、生産的であることを求めません。書きたいときに、書きたいことだけを残してください。"
      + "体感時間の変化を約束するものではなく、時間を振り返るための道具として作られています。")));
}

// ---------- 起動 ----------

window.addEventListener("hashchange", () => {
  const page = pageFromHash();
  if (!page) {
    history.replaceState(null, "", `#/${ui.page}`);
    return;
  }
  ui.page = page;
  ui.confirmDelete = null;
  ui.confirmReflDel = null;
  render({ focusHeading: true });
});

window.addEventListener("storage", (e) => {
  if (!persistent || e.storageArea !== storage) return;
  if (e.key !== null && e.key !== core.STORAGE_KEY) return;
  store.reload();
  applyFontSize(store.getSettings().font_size);
  flash("info", "ほかのタブでの変更を反映しました。");
  render();
});

for (const ev of ["focus", "pointerdown", "keydown"]) window.addEventListener(ev, markPresence, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") markPresence();
});

setInterval(() => {
  const el = document.getElementById("og-elapsed");
  const start = el ? core.parseLocal(el.dataset.start) : null;
  if (start) el.textContent = elapsedText(start);
}, 30 * 1000);
setInterval(checkReminder, 60 * 1000);

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service Worker を登録できませんでした", err));
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "open-page" && PAGE_KEYS.includes(e.data.page)) navigate(e.data.page);
  });
}

applyFontSize(store.getSettings().font_size);
ui.page = pageFromHash() || "record";
if (!pageFromHash()) history.replaceState(null, "", `#/${ui.page}`);
render();