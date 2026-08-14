import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppData,
  ColumnWidths,
  MIN_COLUMN_WIDTHS,
  PartialDate,
  Project,
  ProjectTemplate,
  Section,
  Settings,
  TemplateProject,
  Theme,
  newId,
} from "./types";
import { generateOutput, sortProjects } from "./format";
import { isTauri, loadData, saveData } from "./storage";
import { version as APP_VERSION } from "../package.json";
// トークンを先に読み込む。App.css 側が後勝ちで上書きできる順序にする
import "./ymb-base.css";
import "./App.css";

/** マスタにない現在値も選択肢に含めたoptionsを作る */
function withCurrent(options: string[], current: string): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 日付の年+月を "YYYY-MM" のキーにまとめる(年か月が未定の場合は "" = 未定) */
function monthKey(p: Project): string {
  const { year, month } = p.date;
  if (year === null || month === null) return "";
  return `${year}-${pad2(month)}`;
}

/** "YYYY-MM" → "2026年06月"。空文字は「日付未定」 */
function monthLabel(key: string): string {
  if (!key) return "日付未定";
  const [y, m] = key.split("-");
  return `${y}年${m}月`;
}

const GITHUB_REPO = "yumebi/ymb_progress-list";
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

/** "1.2.3" 同士を比較。aがbより新しければtrue */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** GitHub Releasesの最新バージョンを取得(取得失敗時はnull) */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!res.ok) return null;
    const json = await res.json();
    const tag = String(json.tag_name ?? "");
    return tag.replace(/^v/, "") || null;
  } catch {
    return null;
  }
}

async function openReleasesPage() {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(RELEASES_URL);
  } else {
    window.open(RELEASES_URL, "_blank");
  }
}

/**
 * 新しいバージョンが公開されている旨のダイアログを表示し、リリースページを開くか尋ねる。
 * ブラウザ実行時(開発時のプレビュー等)はwindow.confirmがレンダリングをブロックするため出さず、
 * ツールバーのバッジ表示のみに留める。
 */
async function askOpenReleasesPage(latest: string): Promise<boolean> {
  if (!isTauri) return false;
  const msg = `新しいバージョン v${latest} が公開されています。\nリリースページを開きますか？`;
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(msg, { title: "アップデートのお知らせ", kind: "info", okLabel: "開く", cancelLabel: "閉じる" });
}

/** ドラッグで幅を調整するハンドル(横方向)。net幅0で配置できるよう呼び出し側でmargin調整する */
function ResizeHandle({ onResize }: { onResize: (deltaPx: number) => void }) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let lastX = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - lastX;
      lastX = ev.clientX;
      onResize(delta);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return <div className="resize-handle" onMouseDown={onMouseDown} />;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** 年・月・日それぞれ未定を選べる日付入力。カレンダーからの一括選択も可能 */
function DateInput({
  value,
  onChange,
}: {
  value: PartialDate;
  onChange: (v: PartialDate) => void;
}) {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => thisYear - 1 + i);
  const calendarRef = useRef<HTMLInputElement>(null);
  const isoValue =
    value.year !== null && value.month !== null && value.day !== null
      ? `${value.year}-${pad2(value.month)}-${pad2(value.day)}`
      : "";
  return (
    <div className="date-input">
      <select
        title="年"
        value={value.year ?? ""}
        onChange={(e) =>
          onChange({
            ...value,
            year: e.target.value ? Number(e.target.value) : null,
          })
        }
      >
        <option value="">未定</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select
        title="月"
        value={value.month ?? ""}
        onChange={(e) =>
          onChange({
            ...value,
            month: e.target.value ? Number(e.target.value) : null,
          })
        }
      >
        <option value="">未定</option>
        {MONTHS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        title="日"
        value={value.day ?? ""}
        onChange={(e) =>
          onChange({
            ...value,
            day: e.target.value ? Number(e.target.value) : null,
          })
        }
      >
        <option value="">未定</option>
        {DAYS.map((day) => (
          <option key={day} value={day}>
            {day}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="calendar-btn"
        title="カレンダーから選択"
        onClick={() => calendarRef.current?.showPicker?.()}
      >
        📅
      </button>
      <input
        ref={calendarRef}
        type="date"
        className="calendar-hidden-input"
        value={isoValue}
        onChange={(e) => {
          const m = e.target.value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!m) return;
          onChange({ year: +m[1], month: +m[2], day: +m[3] });
        }}
      />
    </div>
  );
}

/** 進捗率: 数値入力+スライダー(ドラッグ) */
function ProgressInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="progress-input">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        style={{
          background: `linear-gradient(to right, var(--accent) ${value}%, var(--track-bg) ${value}%)`,
        }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="progress-number">
        <input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(e) =>
            onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
          }
        />
        <span className="pct">%</span>
      </div>
    </div>
  );
}

function ColumnHeader({
  onResize,
}: {
  onResize: (key: keyof ColumnWidths, delta: number) => void;
}) {
  return (
    <div className="project-row header-row">
      <div className="cell marker-select header-cell">済</div>
      <ResizeHandle onResize={(d) => onResize("marker", d)} />
      <div className="cell date-input header-cell">日付</div>
      <ResizeHandle onResize={(d) => onResize("date", d)} />
      <div className="cell title-input header-cell" />
      <ResizeHandle onResize={(d) => onResize("title", d)} />
      <div className="cell status-select header-cell">ステータス</div>
      <ResizeHandle onResize={(d) => onResize("status", d)} />
      <div className="cell progress-input header-cell">進捗率</div>
      <ResizeHandle onResize={(d) => onResize("progress", d)} />
      <div className="cell order-select header-cell">発注書</div>
      <ResizeHandle onResize={(d) => onResize("order", d)} />
      <div className="header-spacer" />
    </div>
  );
}

function ProjectRow({
  project,
  settings,
  onChange,
  onDelete,
}: {
  project: Project;
  settings: Settings;
  onChange: (patch: Partial<Project>) => void;
  onDelete: () => void;
}) {
  return (
    <div className={`project-row ${project.marker === "✗" ? "row-lost" : ""}`}>
      <select
        className="cell marker-select"
        title="済"
        value={project.marker}
        onChange={(e) => onChange({ marker: e.target.value })}
      >
        {withCurrent(settings.markers, project.marker).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <div className="cell">
        <DateInput value={project.date} onChange={(date) => onChange({ date })} />
      </div>
      <input
        className="cell title-input"
        value={project.title}
        placeholder="案件名"
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <select
        className="cell status-select"
        title="ステータス"
        value={project.status}
        onChange={(e) => onChange({ status: e.target.value })}
      >
        <option value="">（なし）</option>
        {withCurrent(settings.statuses, project.status).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <div className="cell">
        <ProgressInput
          value={project.progress}
          onChange={(progress) => onChange({ progress })}
        />
      </div>
      <select
        className="cell order-select"
        title="発注書"
        value={project.order}
        onChange={(e) => onChange({ order: e.target.value })}
      >
        <option value="">（なし）</option>
        {withCurrent(settings.orderOptions, project.order).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button className="icon-btn danger" title="削除" onClick={onDelete}>
        ✕
      </button>
    </div>
  );
}

function SectionEditor({
  section,
  projects,
  settings,
  isFirst,
  isLast,
  onRename,
  onMove,
  onDelete,
  onAddProject,
  onChangeProject,
  onDeleteProject,
  onResizeColumn,
  onSaveTemplate,
  onAddFromTemplate,
}: {
  section: Section;
  projects: Project[];
  settings: Settings;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onAddProject: () => void;
  onChangeProject: (id: string, patch: Partial<Project>) => void;
  onDeleteProject: (id: string) => void;
  onResizeColumn: (key: keyof ColumnWidths, delta: number) => void;
  onSaveTemplate: () => void;
  onAddFromTemplate: () => void;
}) {
  const sorted = sortProjects(projects);
  return (
    <div className="section-card">
      <div className="section-header">
        <span className="section-mark">■</span>
        <input
          className="section-name"
          value={section.name}
          placeholder="カテゴリ名(例: サンプルカテゴリA)"
          onChange={(e) => onRename(e.target.value)}
        />
        <button
          className="icon-btn"
          title="このカテゴリをテンプレート保存"
          onClick={onSaveTemplate}
        >
          ⤓保存
        </button>
        <button
          className="icon-btn"
          title="テンプレートから案件を追加"
          onClick={onAddFromTemplate}
        >
          ⤒追加
        </button>
        <button
          className="icon-btn"
          disabled={isFirst}
          title="上へ"
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          className="icon-btn"
          disabled={isLast}
          title="下へ"
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <button
          className="icon-btn danger"
          title="カテゴリ削除"
          onClick={onDelete}
        >
          ✕
        </button>
      </div>
      {sorted.length > 0 && (
        <ColumnHeader onResize={onResizeColumn} />
      )}
      {sorted.map((p) => (
        <ProjectRow
          key={p.id}
          project={p}
          settings={settings}
          onChange={(patch) => onChangeProject(p.id, patch)}
          onDelete={() => onDeleteProject(p.id)}
        />
      ))}
      <button className="add-project-btn" onClick={onAddProject}>
        ＋ 案件を追加
      </button>
    </div>
  );
}

/** マスタ(選択肢)1種類分のリスト編集 */
function ListEditor({
  title,
  items,
  maxLength,
  onChange,
}: {
  title: string;
  items: string[];
  maxLength?: number;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <div className="list-editor">
      <div className="list-editor-title">{title}</div>
      {items.map((item, i) => (
        <div key={item} className="list-editor-item">
          <span>{item}</span>
          <span className="list-editor-btns">
            <button
              className="icon-btn"
              disabled={i === 0}
              onClick={() => {
                const next = [...items];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next);
              }}
            >
              ↑
            </button>
            <button
              className="icon-btn danger"
              onClick={() => onChange(items.filter((x) => x !== item))}
            >
              ✕
            </button>
          </span>
        </div>
      ))}
      <div className="list-editor-add">
        <input
          value={draft}
          maxLength={maxLength}
          placeholder="追加…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button onClick={add}>＋</button>
      </div>
    </div>
  );
}

/** 月次集計: 年+月ごとの案件数・完了数・平均進捗率を表示し、一覧の絞り込みへ移行できる */
function MonthlyStatsModal({
  projects,
  onPickMonth,
  onClose,
}: {
  projects: Project[];
  onPickMonth: (key: string) => void;
  onClose: () => void;
}) {
  const byMonth = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of projects) {
      const key = monthKey(p);
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    const rows = Array.from(map.entries()).map(([key, list]) => {
      const done = list.filter((p) => p.marker === "✗" || p.progress >= 100).length;
      const avg = Math.round(
        list.reduce((sum, p) => sum + p.progress, 0) / Math.max(list.length, 1)
      );
      return { key, count: list.length, done, avg };
    });
    // 未定は末尾、それ以外は新しい月から順に並べる
    rows.sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : b.key.localeCompare(a.key)));
    return rows;
  }, [projects]);

  const total = projects.length;
  const totalDone = projects.filter((p) => p.marker === "✗" || p.progress >= 100).length;
  const totalAvg = Math.round(
    projects.reduce((sum, p) => sum + p.progress, 0) / Math.max(total, 1)
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>月次集計</span>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body modal-body-column">
          <table className="stats-table">
            <thead>
              <tr>
                <th>年月</th>
                <th>案件数</th>
                <th>完了(✗/100%)</th>
                <th>平均進捗率</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {byMonth.map((row) => (
                <tr key={row.key}>
                  <td>{monthLabel(row.key)}</td>
                  <td>{row.count}</td>
                  <td>{row.done}</td>
                  <td>{row.avg}%</td>
                  <td>
                    <button
                      className="small-btn"
                      onClick={() => onPickMonth(row.key)}
                      title="この月の案件だけを一覧に表示"
                    >
                      表示
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>合計</td>
                <td>{total}</td>
                <td>{totalDone}</td>
                <td>{totalAvg}%</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

/** テンプレート保存: カテゴリ内の案件をテンプレートとして保存する */
function TemplateSaveModal({
  defaultName,
  projectCount,
  onSave,
  onClose,
}: {
  defaultName: string;
  projectCount: number;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const submit = () => {
    if (!name.trim()) return;
    onSave(name.trim());
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>テンプレート保存</span>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body modal-body-column">
          <div className="list-editor">
            <label className="field-label">
              テンプレート名(例: 毎月の定例案件)
            </label>
            <input
              className="modal-text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <div className="modal-note">
              {projectCount}件の案件を保存します。日付・進捗率はテンプレートに含めません。
            </div>
            <button
              className="primary"
              disabled={!name.trim()}
              onClick={submit}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** テンプレート選択: 登録済みテンプレートを一覧表示し、追加・削除する */
function TemplatePickModal({
  templates,
  onAdd,
  onDelete,
  onClose,
}: {
  templates: ProjectTemplate[];
  onAdd: (t: ProjectTemplate) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>テンプレートから追加</span>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body modal-body-column">
          {templates.length === 0 ? (
            <div className="modal-note">
              テンプレートはまだありません。カテゴリ右上の「保存」ボタンから作成できます。
            </div>
          ) : (
            templates.map((t) => (
              <div key={t.id} className="template-item">
                <div className="template-info">
                  <div className="template-name">{t.name}</div>
                  <div className="template-meta">{t.projects.length}件の案件</div>
                </div>
                <div className="template-btns">
                  <button className="small-btn" onClick={() => onAdd(t)}>
                    追加
                  </button>
                  <button className="icon-btn danger" onClick={() => onDelete(t.id)}>
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsModal({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>マスタ設定(プルダウンの選択肢)</span>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <ListEditor
            title="済(1文字)"
            items={settings.markers}
            maxLength={2}
            onChange={(markers) => onChange({ ...settings, markers })}
          />
          <ListEditor
            title="ステータス"
            items={settings.statuses}
            onChange={(statuses) => onChange({ ...settings, statuses })}
          />
          <ListEditor
            title="発注書"
            items={settings.orderOptions}
            onChange={(orderOptions) => onChange({ ...settings, orderOptions })}
          />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [toast, setToast] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  // 月次ビュー: "YYYY-MM" または ""(日付未定)の絞り込み。null = 全件表示
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  const [showMonthlyStats, setShowMonthlyStats] = useState(false);
  const [templateSaveSectionId, setTemplateSaveSectionId] = useState<string | null>(null);
  const [templatePickSectionId, setTemplatePickSectionId] = useState<string | null>(null);
  const loaded = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    loadData().then((d) => {
      loaded.current = true;
      setData(d);
    });
  }, []);

  // 起動時にGitHub Releasesの最新バージョンを確認し、あればダイアログで案内
  useEffect(() => {
    fetchLatestVersion().then(async (v) => {
      if (!v || !isNewerVersion(v, APP_VERSION)) return;
      setLatestVersion(v);
      if (await askOpenReleasesPage(v)) openReleasesPage();
    });
  }, []);

  // 変更から500ms後に自動保存
  useEffect(() => {
    if (!loaded.current || !data) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveData(data), 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [data]);

  // テーマをルート要素に反映
  useEffect(() => {
    document.documentElement.dataset.theme = data?.settings.theme ?? "dark";
  }, [data?.settings.theme]);

  const output = useMemo(() => (data ? generateOutput(data) : ""), [data]);

  if (!data) return <div className="loading">読み込み中…</div>;

  const update = (fn: (d: AppData) => AppData) => setData((d) => fn(d!));

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2000);
  };

  const askConfirm = async (msg: string) => {
    if (isTauri) {
      const { confirm } = await import("@tauri-apps/plugin-dialog");
      return confirm(msg, { title: "カテゴリ削除", kind: "warning" });
    }
    return window.confirm(msg);
  };

  const copyOutput = async () => {
    if (isTauri) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(output);
    } else {
      await navigator.clipboard.writeText(output);
    }
    showToast("クリップボードにコピーしました");
  };

  const saveOutput = async () => {
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const filename = `進行状況_${stamp}.txt`;
    if (isTauri) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        defaultPath: filename,
        filters: [{ name: "テキスト", extensions: ["txt"] }],
      });
      if (!path) return;
      await writeTextFile(path, output);
    } else {
      const url = URL.createObjectURL(
        new Blob([output], { type: "text/plain" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
    showToast("保存しました");
  };

  const toggleTheme = () => {
    const next: Theme = data.settings.theme === "dark" ? "light" : "dark";
    update((d) => ({ ...d, settings: { ...d.settings, theme: next } }));
  };

  const resizeColumn = (key: keyof ColumnWidths, delta: number) => {
    update((d) => {
      const current = d.settings.columnWidths[key];
      const next = Math.max(MIN_COLUMN_WIDTHS[key], current + delta);
      return {
        ...d,
        settings: {
          ...d.settings,
          columnWidths: { ...d.settings.columnWidths, [key]: next },
        },
      };
    });
  };

  const resizePreview = (delta: number) => {
    update((d) => ({
      ...d,
      settings: {
        ...d.settings,
        previewWidth: Math.max(240, Math.min(900, d.settings.previewWidth - delta)),
      },
    }));
  };

  const cw = data.settings.columnWidths;
  const editorVars = {
    "--w-marker": `${cw.marker}px`,
    "--w-date": `${cw.date}px`,
    "--w-title": `${cw.title}px`,
    "--w-status": `${cw.status}px`,
    "--w-progress": `${cw.progress}px`,
    "--w-order": `${cw.order}px`,
    "--w-preview": `${data.settings.previewWidth}px`,
  } as React.CSSProperties;

  // 月次ビュー: 絞り込み中の月(または日付未定)に該当する案件だけを表示する
  const visibleProjects =
    monthFilter === null
      ? data.projects
      : data.projects.filter((p) => monthKey(p) === monthFilter);

  const saveTemplate = (name: string) => {
    const sectionId = templateSaveSectionId;
    if (!sectionId) return;
    const template: ProjectTemplate = {
      id: newId(),
      name,
      projects: sortProjects(
        data.projects.filter((p) => p.sectionId === sectionId)
      ).map((p) => ({
        title: p.title,
        marker: p.marker,
        status: p.status,
        order: p.order,
      })),
    };
    update((d) => ({ ...d, templates: [...d.templates, template] }));
    setTemplateSaveSectionId(null);
    showToast("テンプレートを保存しました");
  };

  const addFromTemplate = (template: ProjectTemplate) => {
    const sectionId = templatePickSectionId;
    if (!sectionId) return;
    update((d) => ({
      ...d,
      projects: [
        ...d.projects,
        ...template.projects.map((tp: TemplateProject) => ({
          id: newId(),
          sectionId,
          date: { year: null, month: null, day: null },
          title: tp.title,
          marker: tp.marker,
          status: tp.status,
          progress: 0,
          order: tp.order,
        })),
      ],
    }));
    setTemplatePickSectionId(null);
    showToast(`テンプレート「${template.name}」を追加しました`);
  };

  const deleteTemplate = (id: string) => {
    update((d) => ({ ...d, templates: d.templates.filter((t) => t.id !== id) }));
    showToast("テンプレートを削除しました");
  };

  const pickMonth = (key: string) => {
    setMonthFilter(key);
    setShowMonthlyStats(false);
  };

  return (
    <div className="app" style={editorVars}>
      <header className="toolbar">
        <h1>
          YMB進行状況リスト<span className="app-version">v{APP_VERSION}</span>
        </h1>
        <div className="toolbar-actions">
          {latestVersion && (
            <button className="update-badge" onClick={openReleasesPage}>
              🆕 v{latestVersion} が公開されています
            </button>
          )}
          <button onClick={toggleTheme} title="ダーク/ライト切替">
            {data.settings.theme === "dark" ? "🌙 ダーク" : "☀ ライト"}
          </button>
          <button onClick={() => setShowSettings(true)}>マスタ設定</button>
          <button onClick={() => setShowMonthlyStats(true)}>月次集計</button>
          <button
            onClick={() =>
              update((d) => ({
                ...d,
                sections: [...d.sections, { id: newId(), name: "" }],
              }))
            }
          >
            ＋ カテゴリ追加
          </button>
          <button className="primary" onClick={copyOutput}>
            コピー
          </button>
          <button onClick={saveOutput}>.txt保存</button>
        </div>
      </header>
      <div className="main">
        <div className="editor">
          {monthFilter !== null && (
            <div className="filter-banner">
              <span>
                月次ビュー: {monthFilter === "" ? "日付未定" : monthLabel(monthFilter)} の案件を表示中
              </span>
              <button className="small-btn" onClick={() => setMonthFilter(null)}>
                全件表示に戻る
              </button>
            </div>
          )}
          {data.sections.map((s, i) => (
            <SectionEditor
              key={s.id}
              section={s}
              projects={visibleProjects.filter((p) => p.sectionId === s.id)}
              settings={data.settings}
              isFirst={i === 0}
              isLast={i === data.sections.length - 1}
              onRename={(name) =>
                update((d) => ({
                  ...d,
                  sections: d.sections.map((x) =>
                    x.id === s.id ? { ...x, name } : x
                  ),
                }))
              }
              onMove={(dir) =>
                update((d) => {
                  const sections = [...d.sections];
                  const j = i + dir;
                  [sections[i], sections[j]] = [sections[j], sections[i]];
                  return { ...d, sections };
                })
              }
              onDelete={async () => {
                const count = data.projects.filter(
                  (p) => p.sectionId === s.id
                ).length;
                const ok =
                  count === 0 ||
                  (await askConfirm(
                    `「${s.name}」と配下の${count}件の案件を削除します。よろしいですか?`
                  ));
                if (!ok) return;
                update((d) => ({
                  ...d,
                  sections: d.sections.filter((x) => x.id !== s.id),
                  projects: d.projects.filter((p) => p.sectionId !== s.id),
                }));
              }}
              onAddProject={() =>
                update((d) => ({
                  ...d,
                  projects: [
                    ...d.projects,
                    {
                      id: newId(),
                      sectionId: s.id,
                      date: { year: null, month: null, day: null },
                      title: "",
                      marker: d.settings.markers[0] ?? "・",
                      status: "",
                      progress: 0,
                      order: "",
                    },
                  ],
                }))
              }
              onChangeProject={(id, patch) =>
                update((d) => ({
                  ...d,
                  projects: d.projects.map((p) =>
                    p.id === id ? { ...p, ...patch } : p
                  ),
                }))
              }
              onDeleteProject={(id) =>
                update((d) => ({
                  ...d,
                  projects: d.projects.filter((p) => p.id !== id),
                }))
              }
              onResizeColumn={resizeColumn}
              onSaveTemplate={() => setTemplateSaveSectionId(s.id)}
              onAddFromTemplate={() => setTemplatePickSectionId(s.id)}
            />
          ))}
        </div>
        <ResizeHandle onResize={resizePreview} />
        <div className="preview">
          <div className="preview-header">出力プレビュー</div>
          <pre>{output}</pre>
        </div>
      </div>
      {showSettings && (
        <SettingsModal
          settings={data.settings}
          onChange={(settings) => update((d) => ({ ...d, settings }))}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showMonthlyStats && (
        <MonthlyStatsModal
          projects={data.projects}
          onPickMonth={pickMonth}
          onClose={() => setShowMonthlyStats(false)}
        />
      )}
      {templateSaveSectionId && (
        <TemplateSaveModal
          defaultName={
            data.sections.find((s) => s.id === templateSaveSectionId)?.name ?? ""
          }
          projectCount={
            data.projects.filter((p) => p.sectionId === templateSaveSectionId).length
          }
          onSave={saveTemplate}
          onClose={() => setTemplateSaveSectionId(null)}
        />
      )}
      {templatePickSectionId && (
        <TemplatePickModal
          templates={data.templates}
          onAdd={addFromTemplate}
          onDelete={deleteTemplate}
          onClose={() => setTemplatePickSectionId(null)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
