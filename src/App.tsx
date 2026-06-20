import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppData,
  ColumnWidths,
  MIN_COLUMN_WIDTHS,
  PartialDate,
  Project,
  Section,
  Settings,
  Theme,
  newId,
} from "./types";
import { generateOutput, sortProjects } from "./format";
import { isTauri, loadData, saveData } from "./storage";
import { version as APP_VERSION } from "../package.json";
import "./App.css";

/** マスタにない現在値も選択肢に含めたoptionsを作る */
function withCurrent(options: string[], current: string): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

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
  const loaded = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    loadData().then((d) => {
      loaded.current = true;
      setData(d);
    });
  }, []);

  // 変更から500ms後に自動保存
  useEffect(() => {
    if (!loaded.current || !data) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveData(data), 500);
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

  return (
    <div className="app" style={editorVars}>
      <header className="toolbar">
        <h1>
          YMB進行状況リスト<span className="app-version">v{APP_VERSION}</span>
        </h1>
        <div className="toolbar-actions">
          <button onClick={toggleTheme} title="ダーク/ライト切替">
            {data.settings.theme === "dark" ? "🌙 ダーク" : "☀ ライト"}
          </button>
          <button onClick={() => setShowSettings(true)}>マスタ設定</button>
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
          {data.sections.map((s, i) => (
            <SectionEditor
              key={s.id}
              section={s}
              projects={data.projects.filter((p) => p.sectionId === s.id)}
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
