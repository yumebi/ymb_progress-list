/** 年/月/日それぞれが未定(null)を許容する日付 */
export interface PartialDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

export const EMPTY_DATE: PartialDate = { year: null, month: null, day: null };

export interface Project {
  id: string;
  sectionId: string;
  date: PartialDate;
  title: string;
  /** 行頭記号(・ ※ ✗ などマスタから選択。「済」列として表示) */
  marker: string;
  /** ステータス(マスタから選択) */
  status: string;
  /** 進捗率 0-100 */
  progress: number;
  /** 発注書(有 / 無 / 済 などマスタから選択。"" = 未設定) */
  order: string;
}

export interface Section {
  id: string;
  name: string;
}

export type Theme = "dark" | "light";

/** 各列の幅(px)。ユーザーがドラッグで調整可能 */
export interface ColumnWidths {
  marker: number;
  date: number;
  title: number;
  status: number;
  progress: number;
  order: number;
}

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  marker: 56,
  date: 220,
  title: 220,
  status: 120,
  progress: 176,
  order: 84,
};

export const MIN_COLUMN_WIDTHS: ColumnWidths = {
  marker: 40,
  date: 180,
  title: 80,
  status: 80,
  progress: 130,
  order: 60,
};

/** プルダウン選択肢のマスタ(設定画面で編集可能) */
export interface Settings {
  markers: string[];
  statuses: string[];
  orderOptions: string[];
  theme: Theme;
  columnWidths: ColumnWidths;
  /** 出力プレビュー欄の幅(px) */
  previewWidth: number;
}

export interface AppData {
  sections: Section[];
  projects: Project[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  markers: ["・", "※", "✗"],
  statuses: [
    "進行中",
    "確認中",
    "作業中",
    "見積中",
    "対応中",
    "公開済",
    "納品済",
    "失注",
  ],
  orderOptions: ["有", "無", "済"],
  theme: "dark",
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
  previewWidth: 420,
};

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
