// File: core.js
/**
 * ひととき帳のデータ保存と計算ロジック。
 * DOM に依存しないため、Node.js の node:test で単体テストできます。
 * 記録はブラウザの localStorage（端末内）にだけ保存し、外部へは送信しません。
 */

export const APP_ID = "hitotoki";
export const EXPORT_VERSION = 1;
export const STORAGE_KEY = "hitotoki.v1";

export const CATEGORIES = ["仕事", "家事", "移動", "休憩", "食事", "趣味", "その他"];

export const CATEGORY_COLORS = {
  "仕事": "#4E6E9E",
  "家事": "#B9824A",
  "移動": "#7A6CA8",
  "休憩": "#5E9C7E",
  "食事": "#C9705F",
  "趣味": "#B89A2E",
  "その他": "#7F8791",
};

export const FEELINGS = ["短く感じた", "ふつう", "長く感じた"];
export const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

export const NAME_MAX = 40;
export const MEMO_MAX = 200;
export const ANSWER_MAX = 500;
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const MAX_DURATION_MS = 24 * HOUR;

export const REFLECTION_QUESTIONS = [
  ["impressive", "今日、印象に残った時間は？"],
  ["felt", "思ったより長く感じた／短く感じた時間は？"],
  ["again", "また過ごしたいと思った時間は？"],
  ["note", "今日の自分に、ひとこと残すなら？"],
];

export const NOTIFY_INTERVALS = {
  "30分ごと": 30,
  "1時間ごと": 60,
  "2時間ごと": 120,
  "3時間ごと": 180,
  "1日1回（夜）": null,
};
export const NOTIFY_FREQUENCIES = Object.keys(NOTIFY_INTERVALS);
export const NIGHTLY_HOUR = 21;

export const DEFAULT_SETTINGS = Object.freeze({
  font_size: "標準",
  show_gap_add: true,
  notify_enabled: false,
  notify_frequency: "2時間ごと",
  notify_quiet_start: "22:00",
  notify_quiet_end: "08:00",
  notify_days: ["月", "火", "水", "木", "金", "土", "日"],
  ongoing: null,
});

// 架空のサンプル（実在の人物・実データではありません）
const WEEKDAY_TEMPLATE = [
  [7, 0, 7, 30, "朝ごはん", "食事", null, ""],
  [8, 30, 9, 10, "電車で移動", "移動", null, ""],
  [9, 30, 12, 0, "資料づくり", "仕事", null, "サンプルのメモです"],
  [12, 0, 12, 45, "昼ごはん", "食事", "短く感じた", ""],
  [13, 0, 15, 30, "打ち合わせと作業", "仕事", "長く感じた", ""],
  [15, 30, 15, 50, "コーヒー休憩", "休憩", null, ""],
  [18, 30, 19, 0, "夕飯の準備", "家事", null, ""],
  [19, 0, 19, 40, "夕ごはん", "食事", null, ""],
  [21, 0, 22, 0, "読書", "趣味", "短く感じた", ""],
];

const WEEKEND_TEMPLATE = [
  [9, 0, 9, 40, "ゆっくり朝ごはん", "食事", null, ""],
  [10, 0, 11, 0, "洗濯と掃除", "家事", null, ""],
  [13, 0, 15, 0, "散歩", "趣味", "短く感じた", "サンプルのメモです"],
  [15, 0, 15, 30, "昼寝", "休憩", null, ""],
  [19, 0, 20, 0, "夕ごはん", "食事", null, ""],
];

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = "StorageError";
  }
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

// ---------- 日時ユーティリティ（すべて端末のローカル時刻） ----------

const pad = (n) => String(n).padStart(2, "0");

export function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

export function mondayIndex(d) {
  return (d.getDay() + 6) % 7;
}

export function toDateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeStr(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toLocalISO(d) {
  return `${toDateKey(d)}T${toTimeStr(d)}`;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocal(value) {
  const m = ISO_RE.exec(String(value ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d
    || dt.getHours() !== h || dt.getMinutes() !== mi) {
    return null;
  }
  return dt;
}

export function parseDateKey(value) {
  const m = DATE_RE.exec(String(value ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayBounds(d) {
  const lo = startOfDay(d);
  return [lo, addDays(lo, 1)];
}

export function weekStart(d) {
  return addDays(startOfDay(d), -mondayIndex(d));
}

export function floorMinute(d) {
  const x = new Date(d.getTime());
  x.setSeconds(0, 0);
  return x;
}

export function roundDown(d, minutes = 5) {
  const x = floorMinute(d);
  x.setMinutes(x.getMinutes() - (x.getMinutes() % minutes));
  return x;
}

export function clip(start, end, lo, hi) {
  const s = Math.max(start.getTime(), lo.getTime());
  const e = Math.min(end.getTime(), hi.getTime());
  return e > s ? [new Date(s), new Date(e)] : null;
}

export function fmtMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}時間${m}分`;
  if (h) return `${h}時間`;
  return `${m}分`;
}

export function formatDay(d) {
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[mondayIndex(d)]}）`;
}

export function hmToMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// ---------- 区間の計算 ----------

export function mergeIntervals(intervals) {
  const items = intervals
    .map(([s, e]) => [s.getTime(), e.getTime()])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [s, e] of items) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      if (e > last[1]) last[1] = e;
    } else {
      merged.push([s, e]);
    }
  }
  return merged.map(([s, e]) => [new Date(s), new Date(e)]);
}

export function unionMinutes(intervals) {
  return mergeIntervals(intervals).reduce((sum, [s, e]) => sum + (e - s) / MINUTE, 0);
}

/** 記録と記録のあいだの時間（最初の記録より前・最後の記録より後は含めない）。 */
export function findGaps(intervals, minMinutes = 30) {
  const merged = mergeIntervals(intervals);
  const gaps = [];
  for (let i = 0; i + 1 < merged.length; i += 1) {
    const aEnd = merged[i][1];
    const bStart = merged[i + 1][0];
    if (bStart - aEnd >= minMinutes * MINUTE) gaps.push([aEnd, bStart]);
  }
  return gaps;
}

/** 重なる区間を別の段に振り分ける（入力と同じ順で段番号を返す）。 */
export function assignLanes(intervals) {
  const order = intervals
    .map((_, i) => i)
    .sort((a, b) => intervals[a][0] - intervals[b][0] || intervals[a][1] - intervals[b][1]);
  const laneEnds = [];
  const lanes = new Array(intervals.length).fill(0);
  for (const i of order) {
    const [s, e] = intervals[i];
    let placed = false;
    for (let li = 0; li < laneEnds.length; li += 1) {
      if (laneEnds[li] <= s.getTime()) {
        lanes[i] = li;
        laneEnds[li] = e.getTime();
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes[i] = laneEnds.length;
      laneEnds.push(e.getTime());
    }
  }
  return lanes;
}

/** 日×カテゴリの分数（0分も含む全組み合わせ）。日をまたぐ記録は日ごとに分けて数える。 */
export function dailyCategoryMinutes(records, days) {
  const rows = [];
  for (const d of days) {
    const [lo, hi] = dayBounds(d);
    const totals = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    for (const r of records) {
      if (!CATEGORIES.includes(r.category)) continue;
      const c = clip(r.start, r.end, lo, hi);
      if (c) totals[r.category] += (c[1] - c[0]) / MINUTE;
    }
    for (const cat of CATEGORIES) rows.push({ day: toDateKey(d), category: cat, minutes: totals[cat] });
  }
  return rows;
}

export function dailyUnionMinutes(records, days) {
  const out = {};
  for (const d of days) {
    const [lo, hi] = dayBounds(d);
    const ivs = records.map((r) => clip(r.start, r.end, lo, hi)).filter(Boolean);
    out[toDateKey(d)] = unionMinutes(ivs);
  }
  return out;
}

export function hourlyCategoryMinutes(records, lo, hi) {
  const totals = new Map();
  for (const r of records) {
    const c = clip(r.start, r.end, lo, hi);
    if (!c) continue;
    let cur = c[0];
    const end = c[1];
    while (cur < end) {
      const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), cur.getHours() + 1);
      const segEnd = next < end ? next : end;
      if (segEnd <= cur) break;
      const key = `${cur.getHours()}|${r.category}`;
      totals.set(key, (totals.get(key) || 0) + (segEnd - cur) / MINUTE);
      cur = segEnd;
    }
  }
  return [...totals]
    .map(([key, minutes]) => {
      const [hour, category] = key.split("|");
      return { hour: Number(hour), category, minutes };
    })
    .sort((a, b) => a.hour - b.hour || CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
}

// ---------- 統計 ----------

/** 線形補間による分位点（pandas の既定と同じ方式）。 */
export function quantile(values, q) {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function median(values) {
  return quantile(values, 0.5);
}

// ---------- 入力チェック ----------

export function validateRecord(name, category, start, end, memo, feeling) {
  const errors = [];
  const n = String(name ?? "").trim();
  if (!n) errors.push("活動名を入力してください。");
  else if (n.length > NAME_MAX) errors.push(`活動名は${NAME_MAX}文字以内にしてください。`);
  if (!CATEGORIES.includes(category)) errors.push("カテゴリを選んでください。");
  if (!isValidDate(start) || !isValidDate(end)) {
    errors.push("開始時刻と終了時刻を入力してください。");
  } else if (end.getTime() <= start.getTime()) {
    errors.push("終了時刻は開始時刻より後にしてください。日をまたぐ場合は「翌日に終了」をオンにしてください。");
  } else if (end.getTime() - start.getTime() > MAX_DURATION_MS) {
    errors.push("24時間を超える記録は、分けて登録してください。");
  }
  if (memo && String(memo).length > MEMO_MAX) errors.push(`メモは${MEMO_MAX}文字以内にしてください。`);
  if (feeling !== null && feeling !== undefined && !FEELINGS.includes(feeling)) {
    errors.push("体感の値が正しくありません。");
  }
  return errors;
}

function cleanAnswers(answers) {
  const out = {};
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return out;
  for (const [k, v] of Object.entries(answers)) {
    if (typeof v !== "string") continue;
    const s = v.trim().slice(0, ANSWER_MAX);
    if (s) out[String(k)] = s;
  }
  return out;
}

// ---------- CSV ----------

/** 表計算ソフトで数式として解釈されないようにする。 */
export function csvSafe(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (s && ["=", "+", "-", "@", "\t", "\r"].includes(s[0])) return `'${s}`;
  return s;
}

function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function recordsToCSV(records) {
  const rows = [["id", "活動名", "カテゴリ", "開始", "終了", "長さ（分）", "体感", "メモ", "サンプル"]];
  for (const r of records) {
    rows.push([
      r.id,
      csvSafe(r.name),
      r.category,
      toLocalISO(r.start),
      toLocalISO(r.end),
      Math.round((r.end - r.start) / MINUTE),
      r.feeling || "",
      csvSafe(r.memo),
      r.is_sample ? "はい" : "",
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

// ---------- サンプル ----------

export function sampleRecords(now) {
  const out = [];
  const today = startOfDay(now);
  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = addDays(today, -offset);
    const template = mondayIndex(d) >= 5 ? WEEKEND_TEMPLATE : WEEKDAY_TEMPLATE;
    template.forEach(([sh, sm, eh, em, name, category, feeling, memo], idx) => {
      if ((idx + offset) % 4 === 3) return;
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm);
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em);
      if (end > now) return;
      out.push({ name, category, start, end, memo, feeling });
    });
  }
  return out;
}

// ---------- 通知の判定 ----------

export function inQuietHours(nowMinutes, quietStart, quietEnd) {
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) return nowMinutes >= quietStart && nowMinutes < quietEnd;
  return nowMinutes >= quietStart || nowMinutes < quietEnd;
}

/** 設定と最後にお知らせした（または利用していた）時刻から、いまお知らせするかを決める。 */
export function notifyDue(settings, now, lastMs) {
  if (!settings || !settings.notify_enabled) return false;
  if (typeof lastMs !== "number" || !Number.isFinite(lastMs)) return false;
  const days = Array.isArray(settings.notify_days) ? settings.notify_days : [];
  if (!days.includes(WEEKDAYS[mondayIndex(now)])) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const qs = hmToMinutes(settings.notify_quiet_start);
  const qe = hmToMinutes(settings.notify_quiet_end);
  if (qs !== null && qe !== null && inQuietHours(nowMinutes, qs, qe)) return false;
  if (!Object.prototype.hasOwnProperty.call(NOTIFY_INTERVALS, settings.notify_frequency)) return false;
  const interval = NOTIFY_INTERVALS[settings.notify_frequency];
  if (interval === null) {
    const threshold = new Date(now.getFullYear(), now.getMonth(), now.getDate(), NIGHTLY_HOUR);
    return now >= threshold && lastMs < threshold.getTime();
  }
  return now.getTime() - lastMs >= interval * MINUTE;
}

// ---------- 保存 ----------

export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "");
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Date.now().toString(16) + Math.random().toString(16).slice(2);
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function emptyState() {
  return { app: APP_ID, version: EXPORT_VERSION, records: [], reflections: {}, settings: {} };
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanStoredRecord(r) {
  if (!r || typeof r !== "object") return null;
  const start = parseLocal(r.start);
  const end = parseLocal(r.end);
  const name = typeof r.name === "string" ? r.name.trim() : "";
  const memo = typeof r.memo === "string" ? r.memo : "";
  const feeling = r.feeling ?? null;
  if (validateRecord(name, r.category, start, end, memo, feeling).length) return null;
  return {
    id: String(r.id || newId()),
    name,
    category: r.category,
    start: toLocalISO(start),
    end: toLocalISO(end),
    memo: memo.trim(),
    feeling,
    is_sample: Boolean(r.is_sample),
    created_at: String(r.created_at || ""),
    updated_at: String(r.updated_at || ""),
  };
}

function normalizeState(data) {
  if (!data || typeof data !== "object" || data.app !== APP_ID || !Array.isArray(data.records)) {
    throw new Error("invalid state");
  }
  const state = emptyState();
  let dropped = 0;
  const seen = new Set();
  for (const raw of data.records) {
    const rec = cleanStoredRecord(raw);
    if (!rec || seen.has(rec.id)) {
      dropped += 1;
      continue;
    }
    seen.add(rec.id);
    state.records.push(rec);
  }
  if (data.reflections && typeof data.reflections === "object" && !Array.isArray(data.reflections)) {
    for (const [day, item] of Object.entries(data.reflections)) {
      if (!parseDateKey(day) || !item || typeof item !== "object") continue;
      const answers = cleanAnswers(item.answers);
      if (Object.keys(answers).length) {
        state.reflections[day] = {
          answers,
          is_sample: Boolean(item.is_sample),
          updated_at: String(item.updated_at || ""),
        };
      }
    }
  }
  if (data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)) {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (Object.prototype.hasOwnProperty.call(data.settings, key)) state.settings[key] = data.settings[key];
    }
  }
  return { state, dropped };
}

function toRecord(raw) {
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    start: parseLocal(raw.start),
    end: parseLocal(raw.end),
    memo: raw.memo || "",
    feeling: raw.feeling ?? null,
    is_sample: Boolean(raw.is_sample),
  };
}

function compareRecords(a, b) {
  return a.start - b.start || a.end - b.end || String(a.id).localeCompare(String(b.id));
}

function prepareRecord(fields) {
  const start = isValidDate(fields.start) ? floorMinute(fields.start) : null;
  const end = isValidDate(fields.end) ? floorMinute(fields.end) : null;
  const name = String(fields.name ?? "").trim();
  const memo = String(fields.memo ?? "").trim();
  const feeling = fields.feeling ?? null;
  const errors = validateRecord(name, fields.category, start, end, memo, feeling);
  if (errors.length) throw new ValidationError(errors[0]);
  return { name, category: fields.category, start: toLocalISO(start), end: toLocalISO(end), memo, feeling };
}

export class Store {
  constructor(storage, key = STORAGE_KEY) {
    this.storage = storage;
    this.key = key;
    this.reload();
  }

  reload() {
    this.corruptRaw = null;
    this.unreadable = false;
    this.dropped = 0;
    this._sorted = null;
    let raw;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      this.unreadable = true;
      this.state = emptyState();
      return;
    }
    if (raw === null || raw === undefined) {
      this.state = emptyState();
      return;
    }
    try {
      const { state, dropped } = normalizeState(JSON.parse(raw));
      this.state = state;
      this.dropped = dropped;
    } catch {
      this.state = emptyState();
      this.corruptRaw = String(raw);
    }
  }

  get readOnly() {
    return this.unreadable || this.corruptRaw !== null;
  }

  rawText() {
    try {
      return this.storage.getItem(this.key) || "";
    } catch {
      return "";
    }
  }

  _mutate(fn) {
    if (this.readOnly) {
      throw new StorageError("保存されていたデータを読み取れなかったため、上書きしないよう保存を止めています。画面上部の案内をご覧ください。");
    }
    const next = deepCopy(this.state);
    const result = fn(next);
    const text = JSON.stringify(next);
    try {
      this.storage.setItem(this.key, text);
    } catch {
      throw new StorageError("保存できませんでした。ブラウザの保存容量がいっぱいか、保存が許可されていない可能性があります。");
    }
    this.state = next;
    this._sorted = null;
    this.dropped = 0;
    return result;
  }

  _records() {
    if (!this._sorted) this._sorted = this.state.records.map(toRecord).sort(compareRecords);
    return this._sorted;
  }

  // --- 活動記録 ---

  addRecord(fields) {
    const rec = prepareRecord(fields);
    const id = newId();
    const stamp = toLocalISO(new Date());
    this._mutate((s) => {
      s.records.push({ id, ...rec, is_sample: Boolean(fields.isSample), created_at: stamp, updated_at: stamp });
    });
    return id;
  }

  updateRecord(id, fields) {
    const rec = prepareRecord(fields);
    if (!this.state.records.some((r) => r.id === id)) return false;
    this._mutate((s) => {
      const target = s.records.find((r) => r.id === id);
      Object.assign(target, rec, { updated_at: toLocalISO(new Date()) });
    });
    return true;
  }

  deleteRecord(id) {
    if (!this.state.records.some((r) => r.id === id)) return false;
    this._mutate((s) => {
      s.records = s.records.filter((r) => r.id !== id);
    });
    return true;
  }

  getRecord(id) {
    return this._records().find((r) => r.id === id) || null;
  }

  allRecords() {
    return this._records().slice();
  }

  recordsBetween(lo, hi) {
    return this._records().filter((r) => r.start < hi && r.end > lo);
  }

  findOverlaps(start, end, excludeId = null) {
    return this.recordsBetween(start, end).filter((r) => r.id !== excludeId);
  }

  recentActivities(limit = 6) {
    const latest = new Map();
    for (const r of this._records()) {
      const key = `${r.name}\u0000${r.category}`;
      const prev = latest.get(key);
      if (!prev || r.start > prev.start) latest.set(key, r);
    }
    return [...latest.values()]
      .sort((a, b) => b.start - a.start)
      .slice(0, limit)
      .map((r) => [r.name, r.category]);
  }

  latestEndBefore(dt) {
    let best = null;
    for (const r of this._records()) {
      if (r.end <= dt && (!best || r.end > best)) best = r.end;
    }
    return best;
  }

  countRecords() {
    return this.state.records.length;
  }

  hasSamples() {
    return this.state.records.some((r) => r.is_sample)
      || Object.values(this.state.reflections).some((x) => x.is_sample);
  }

  // --- 振り返り ---

  getReflection(dayKey) {
    const item = this.state.reflections[dayKey];
    return item ? { ...item.answers } : {};
  }

  saveReflection(dayKey, answers, isSample = false) {
    if (!parseDateKey(dayKey)) throw new ValidationError("日付が正しくありません。");
    const cleaned = cleanAnswers(answers);
    if (!Object.keys(cleaned).length) {
      if (this.state.reflections[dayKey]) {
        this._mutate((s) => {
          delete s.reflections[dayKey];
        });
      }
      return false;
    }
    this._mutate((s) => {
      s.reflections[dayKey] = { answers: cleaned, is_sample: Boolean(isSample), updated_at: toLocalISO(new Date()) };
    });
    return true;
  }

  deleteReflection(dayKey) {
    if (!this.state.reflections[dayKey]) return false;
    this._mutate((s) => {
      delete s.reflections[dayKey];
    });
    return true;
  }

  reflectionsBetween(startKey, endKey) {
    const out = {};
    for (const key of Object.keys(this.state.reflections).sort()) {
      if (key >= startKey && key <= endKey) out[key] = { ...this.state.reflections[key].answers };
    }
    return out;
  }

  // --- 設定 ---

  getSettings() {
    return { ...deepCopy(DEFAULT_SETTINGS), ...deepCopy(this.state.settings) };
  }

  setSetting(key, value) {
    this.setSettings({ [key]: value });
  }

  setSettings(values) {
    for (const key of Object.keys(values)) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) throw new Error(`unknown setting: ${key}`);
    }
    this._mutate((s) => {
      for (const [key, value] of Object.entries(values)) s.settings[key] = value === undefined ? null : value;
    });
  }

  // --- サンプルと削除 ---

  insertSamples(now = new Date()) {
    if (this.hasSamples()) return 0;
    const items = sampleRecords(now);
    const stamp = toLocalISO(new Date());
    this._mutate((s) => {
      for (const r of items) {
        s.records.push({
          id: newId(),
          name: r.name,
          category: r.category,
          start: toLocalISO(r.start),
          end: toLocalISO(r.end),
          memo: r.memo,
          feeling: r.feeling,
          is_sample: true,
          created_at: stamp,
          updated_at: stamp,
        });
      }
      const yesterday = toDateKey(addDays(startOfDay(now), -1));
      if (!s.reflections[yesterday]) {
        s.reflections[yesterday] = {
          answers: {
            impressive: "（サンプル）夕方の散歩で見た空の色",
            felt: "（サンプル）打ち合わせは長く、読書の時間は短く感じた",
          },
          is_sample: true,
          updated_at: stamp,
        };
      }
    });
    return items.length;
  }

  deleteSamples() {
    this._mutate((s) => {
      s.records = s.records.filter((r) => !r.is_sample);
      for (const [key, item] of Object.entries(s.reflections)) {
        if (item.is_sample) delete s.reflections[key];
      }
    });
  }

  deleteAllRecords() {
    this._mutate((s) => {
      s.records = [];
      delete s.settings.ongoing;
    });
  }

  deleteAllReflections() {
    this._mutate((s) => {
      s.reflections = {};
    });
  }

  /** 保存領域ごと削除する（読み取れないデータの初期化にも使う）。 */
  deleteEverything() {
    try {
      this.storage.removeItem(this.key);
    } catch {
      throw new StorageError("削除できませんでした。ブラウザの設定をご確認ください。");
    }
    this.state = emptyState();
    this.corruptRaw = null;
    this.unreadable = false;
    this.dropped = 0;
    this._sorted = null;
  }

  // --- 書き出し・読み込み（Streamlit 版と同じ形式） ---

  exportDict(now = new Date()) {
    return {
      app: APP_ID,
      version: EXPORT_VERSION,
      exported_at: `${toLocalISO(now)}:00`,
      records: this._records().map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        start: `${toLocalISO(r.start)}:00`,
        end: `${toLocalISO(r.end)}:00`,
        memo: r.memo,
        feeling: r.feeling,
        is_sample: r.is_sample,
      })),
      reflections: Object.keys(this.state.reflections).sort().map((day) => ({
        day,
        answers: { ...this.state.reflections[day].answers },
        is_sample: Boolean(this.state.reflections[day].is_sample),
      })),
    };
  }

  importDict(data) {
    if (!data || typeof data !== "object" || Array.isArray(data) || data.app !== APP_ID) {
      throw new ValidationError("ひととき帳から書き出したJSONファイルではないようです。");
    }
    const records = data.records ?? [];
    const reflections = data.reflections ?? [];
    if (!Array.isArray(records) || !Array.isArray(reflections)) {
      throw new ValidationError("ファイルの形式が正しくありません。");
    }
    let added = 0;
    let skipped = 0;
    let reflAdded = 0;
    const problems = [];
    const stamp = toLocalISO(new Date());
    this._mutate((s) => {
      const existing = new Set(s.records.map((r) => r.id));
      records.forEach((r, i) => {
        const label = `${i + 1}件目`;
        if (!r || typeof r !== "object") {
          problems.push(`${label}：形式が正しくないため読み込みませんでした。`);
          return;
        }
        const start = parseLocal(r.start);
        const end = parseLocal(r.end);
        if (!start || !end) {
          problems.push(`${label}：形式が正しくないため読み込みませんでした。`);
          return;
        }
        const name = r.name === null || r.name === undefined ? "" : String(r.name).trim();
        const memo = r.memo === null || r.memo === undefined ? "" : String(r.memo);
        const feeling = r.feeling ?? null;
        const errs = validateRecord(name, r.category, start, end, memo, feeling);
        if (errs.length) {
          problems.push(`${label}：${errs[0]}`);
          return;
        }
        const id = r.id ? String(r.id) : newId();
        if (existing.has(id)) {
          skipped += 1;
          return;
        }
        s.records.push({
          id,
          name,
          category: r.category,
          start: toLocalISO(start),
          end: toLocalISO(end),
          memo: memo.trim(),
          feeling,
          is_sample: Boolean(r.is_sample),
          created_at: stamp,
          updated_at: stamp,
        });
        existing.add(id);
        added += 1;
      });
      reflections.forEach((item, j) => {
        const day = item && typeof item.day === "string" ? item.day : null;
        if (!day || !parseDateKey(day) || !item.answers || typeof item.answers !== "object" || Array.isArray(item.answers)) {
          problems.push(`振り返り${j + 1}件目：形式が正しくないため読み込みませんでした。`);
          return;
        }
        const cleaned = cleanAnswers(item.answers);
        if (!Object.keys(cleaned).length || s.reflections[day]) return;
        s.reflections[day] = { answers: cleaned, is_sample: Boolean(item.is_sample), updated_at: stamp };
        reflAdded += 1;
      });
    });
    return { added, skipped, reflections: reflAdded, problems };
  }
}