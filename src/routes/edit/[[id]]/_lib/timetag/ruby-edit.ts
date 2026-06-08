// 文字単位のルビ編集ポップアップ (behavior: tt/chart state mutation)
import { chart } from "../../_state/chart.svelte";
import { tt } from "../../_state/timetag.svelte";
import { generateChartRepl } from "../repl/generate";

/**
 * 指定位置 (li, ci) の文字に対応する repl エントリを探してポップアップ state にロード。
 * 単一文字キーが優先、なければ複数文字キーで連続マッチを試行。
 */
export function openRubyEdit(li: number, ci: number): void {
  const lineChars = tt.lines[li]?.chars;
  if (!lineChars) return;
  const ch = lineChars[ci];
  if (!ch) return;

  const replLines = chart.chartReplContent.trim().split("\n");
  const replEntries: { key: string; value: string }[] = [];
  for (const line of replLines) {
    const idx = line.indexOf(",");
    if (idx === -1) continue;
    replEntries.push({
      key: line.substring(0, idx),
      value: line.substring(idx + 1),
    });
  }

  // フォーカス位置 ci を含む形で歌詞に一致する repl キーのうち、最長のものを優先する。
  // 例:「何度」(なん|ど) と「何,なに」がある時、「何」にフォーカスしても歌詞が「何度」なら
  //    より具体的な「何度」を開く (単一文字を先に拾わない)。
  let foundKey = "";
  let foundValue = "";
  let foundStart = ci; // キーが歌詞上で始まる index
  let foundLen = 0;
  for (const e of replEntries) {
    const keyChars = [...e.key];
    for (let offset = 0; offset < keyChars.length; offset++) {
      const startIdx = ci - offset;
      if (startIdx < 0) continue;
      const endIdx = startIdx + keyChars.length;
      if (endIdx > lineChars.length) continue;
      let match = true;
      for (let j = 0; j < keyChars.length; j++) {
        if (lineChars[startIdx + j].char !== keyChars[j]) {
          match = false;
          break;
        }
      }
      if (match && keyChars.length > foundLen) {
        foundKey = e.key;
        foundValue = e.value;
        foundStart = startIdx;
        foundLen = keyChars.length;
      }
    }
  }
  if (!foundKey) {
    foundKey = ch.char;
    foundValue = "";
  }
  tt.rubyEditLine = li;
  tt.rubyEditChar = foundStart; // キーの歌詞上の開始 index (左右拡張に使う)
  tt.rubyEditKey = foundKey;
  tt.rubyEditOrigKey = foundKey;
  tt.rubyEditValue = foundValue;
}

/**
 * ルビ編集中のキー範囲を歌詞上で 1 文字拡張する。
 * dir="left": 左端に前の 1 文字を追加 / dir="right": 右端に次の 1 文字を追加。
 * 歌詞 (tt.lines[li].chars) の文字を取り込み、rubyEditKey と開始位置を更新する。
 */
export function extendRubyKey(dir: "left" | "right"): void {
  if (tt.rubyEditLine < 0) return;
  const lineChars = tt.lines[tt.rubyEditLine]?.chars;
  if (!lineChars) return;
  const keyLen = [...tt.rubyEditKey].length;
  const start = tt.rubyEditChar;
  const end = start + keyLen; // exclusive

  if (dir === "left") {
    if (start <= 0) return;
    const prevChar = lineChars[start - 1]?.char;
    if (prevChar == null) return;
    tt.rubyEditKey = prevChar + tt.rubyEditKey;
    tt.rubyEditChar = start - 1;
  } else {
    if (end >= lineChars.length) return;
    const nextChar = lineChars[end]?.char;
    if (nextChar == null) return;
    tt.rubyEditKey = tt.rubyEditKey + nextChar;
  }
}

/** ポップアップを閉じる */
export function closeRubyEdit(): void {
  tt.rubyEditLine = -1;
  tt.rubyEditChar = -1;
}

/**
 * ルビ編集を確定し、chart.chartReplContent を更新 + repl 最適化 + tt.lines 再構築。
 * @param buildTimeTagLines tt.lines を再構築するコールバック
 */
export function applyRubyEdit(buildTimeTagLines: () => void): void {
  if (tt.rubyEditLine < 0 || !tt.rubyEditKey || !tt.rubyEditValue.trim()) return;
  tt.rubyEditValue = tt.rubyEditValue.replace(/｜/g, "|").replace(/＋/g, "+");
  const oldEntry = tt.rubyEditOrigKey + ",";
  const lines = chart.chartReplContent.trim().split("\n");
  let replaced = false;
  const newLines = lines.map((line) => {
    if (line.startsWith(oldEntry)) {
      replaced = true;
      return tt.rubyEditKey + "," + tt.rubyEditValue;
    }
    return line;
  });
  if (!replaced) newLines.push(tt.rubyEditKey + "," + tt.rubyEditValue);
  const rawRepl = newLines.join("\n");

  // repl 最適化を実行してから ttLines に反映
  const { optimized } = generateChartRepl(
    chart.lrcContent,
    chart.appliedMasterReplContent,
    rawRepl,
    chart.ignorePipeSet,
    false,
  );
  chart.chartReplContent = optimized;
  chart.appliedChartReplContent = optimized;
  buildTimeTagLines();
  closeRubyEdit();
}
