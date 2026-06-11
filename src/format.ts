import { AppData, PartialDate, Project } from "./types";

/** ソート用キー。未定の項目は "00"(各要素中で最も若い値)として扱う */
function dateSortKey(d: PartialDate): string {
  if (d.year === null && d.month === null && d.day === null) return "";
  const y = d.year !== null ? String(d.year).padStart(4, "0") : "0000";
  const m = d.month !== null ? String(d.month).padStart(2, "0") : "00";
  const day = d.day !== null ? String(d.day).padStart(2, "0") : "00";
  return `${y}-${m}-${day}`;
}

/** 日付未定("")はカテゴリ先頭、それ以外は年/月/日の昇順(同値は登録順) */
export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const ka = dateSortKey(a.date);
    const kb = dateSortKey(b.date);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** {2026,6,8} → "26/06/08"。各項目はnullなら"??" */
export function formatDate(d: PartialDate): string {
  const y = d.year !== null ? String(d.year % 100).padStart(2, "0") : "??";
  const m = d.month !== null ? String(d.month).padStart(2, "0") : "??";
  const day = d.day !== null ? String(d.day).padStart(2, "0") : "??";
  return `${y}/${m}/${day}`;
}

/**
 * 1行分のテキストを生成する。
 * 例: ※26/06/08　サンプル案件1　月次修正－確認中（50%）、発注書：有
 * 進捗率は1%以上のときのみ付与、発注書は設定時のみ付与。
 */
export function formatLine(p: Project): string {
  const parts: string[] = [];
  const status = p.status.trim();
  // 括弧・コロンは本文の表記に合わせて全角(（ ） ：)
  const progress = p.progress > 0 ? `（${p.progress}%）` : "";
  if (status || progress) parts.push(`${status}${progress}`);
  if (p.order.trim()) parts.push(`発注書：${p.order.trim()}`);
  const suffix = parts.length > 0 ? `－${parts.join("、")}` : "";
  return `${p.marker}${formatDate(p.date)}　${p.title}${suffix}`;
}

export function generateOutput(data: AppData): string {
  const lines: string[] = [];
  for (const section of data.sections) {
    lines.push(`■${section.name}`);
    const projects = sortProjects(
      data.projects.filter((p) => p.sectionId === section.id)
    );
    for (const p of projects) lines.push(formatLine(p));
  }
  return lines.join("\n");
}
