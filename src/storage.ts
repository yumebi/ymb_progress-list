import { AppData, DEFAULT_SETTINGS, EMPTY_DATE, PartialDate, Project } from "./types";
import { buildSeedData } from "./seed";

/** Tauri上で動いているか(ブラウザ単体での動作確認用フォールバック判定) */
export const isTauri = "__TAURI_INTERNALS__" in window;

const LS_KEY = "progress-list-data";

type TauriStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
};

let store: TauriStore | null = null;

/* ---- 旧スキーマからの変換 ---- */

const OLD_MARKER_MAP: Record<string, string> = {
  normal: "・",
  attention: "※",
  lost: "✗",
};

/** "06/09" "08/下" "06/??" "??/??" "27/02"(年度/月) → 年/月/日(部分一致可) */
function migrateDateText(t: string): PartialDate {
  t = t.trim();
  if (!t || t === "??/??") return { ...EMPTY_DATE };
  const m = t.match(/^(\d{1,2})\/(\d{1,2}|上|中|下|\?\?)$/);
  if (!m) return { ...EMPTY_DATE };
  const first = parseInt(m[1], 10);
  const second = m[2];
  const now = new Date();
  const baseFY =
    now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  if (first > 12) {
    // 年度/月 表記
    const fy = 2000 + first;
    if (second === "??") return { year: fy + 1, month: null, day: null };
    const mo = parseInt(second, 10);
    return { year: mo <= 3 ? fy + 1 : fy, month: mo, day: null };
  }
  const year = first <= 3 ? baseFY + 1 : baseFY;
  if (second === "??") return { year, month: first, day: null };
  const day =
    second === "上" ? 5 : second === "中" ? 15 : second === "下" ? 25 : parseInt(second, 10);
  return { year, month: first, day };
}

/** "2026-06-08" のようなISO日付文字列 → 年/月/日 */
function migrateIsoDate(s: string | null): PartialDate {
  if (!s) return { ...EMPTY_DATE };
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { ...EMPTY_DATE };
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
}

/** 旧ステータス文字列から "（50%）" を進捗率として分離(括弧は全角・半角どちらも対応) */
function extractProgress(status: string): { status: string; progress: number } {
  const m = status.match(/[(（](\d{1,3})%[)）]/);
  if (!m) return { status, progress: 0 };
  return {
    status: status.replace(m[0], "").replace(/、\s*$/, "").trim(),
    progress: Math.min(100, parseInt(m[1], 10)),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrate(raw: any): AppData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projects: Project[] = (raw.projects ?? []).map((p: any) => {
    // v0: dateText文字列+記号enum+ブロック
    if (typeof p.dateText === "string") {
      const { status, progress } = extractProgress(p.status ?? "");
      return {
        id: p.id,
        sectionId: p.sectionId,
        date: migrateDateText(p.dateText),
        title: p.title ?? "",
        marker: OLD_MARKER_MAP[p.marker] ?? p.marker ?? "・",
        status,
        progress,
        order: "",
      };
    }
    // v1: date(ISO文字列|null)+ブロック
    if (typeof p.date === "string" || p.date === null) {
      return {
        id: p.id,
        sectionId: p.sectionId,
        date: migrateIsoDate(p.date),
        title: p.title ?? "",
        marker: p.marker ?? "・",
        status: p.status ?? "",
        progress: p.progress ?? 0,
        order: p.order ?? "",
      };
    }
    // v2: そのまま(blockなど余分なフィールドは無視)
    return {
      id: p.id,
      sectionId: p.sectionId,
      date: p.date ?? { ...EMPTY_DATE },
      title: p.title ?? "",
      marker: p.marker ?? "・",
      status: p.status ?? "",
      progress: p.progress ?? 0,
      order: p.order ?? "",
    };
  });
  return {
    sections: raw.sections ?? [],
    projects,
    settings: { ...structuredClone(DEFAULT_SETTINGS), ...(raw.settings ?? {}) },
  };
}

/** アプリデータフォルダの data.json から読み込む。初回はサンプルデータを投入 */
export async function loadData(): Promise<AppData> {
  if (!isTauri) {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return migrate(JSON.parse(raw));
    return buildSeedData();
  }
  const { load } = await import("@tauri-apps/plugin-store");
  store = await load("data.json");
  const raw = await store.get<unknown>("data");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (raw && Array.isArray((raw as any).sections)) {
    const data = migrate(raw);
    await saveData(data); // マイグレーション結果を書き戻す
    return data;
  }
  const seed = buildSeedData();
  await store.set("data", seed);
  await store.save();
  return seed;
}

export async function saveData(data: AppData): Promise<void> {
  if (!isTauri) {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    return;
  }
  if (!store) return;
  await store.set("data", data);
  await store.save();
}
