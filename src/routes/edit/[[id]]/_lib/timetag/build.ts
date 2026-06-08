// TimeTag 行の構築・LRC 同期 (behavior: chart/tt state mutation)
// 波形キャッシュの再構築は呼び出し側がコールバックで提供する。
import { buildTimeTagData } from "$lib/parseLyric/timetag-parser";
import { chart } from "../../_state/chart.svelte";
import { tt } from "../../_state/timetag.svelte";
import { generateTtLrc } from "./utils";

/**
 * chart.lrcContent と chart.appliedChartReplContent から tt.lines を再構築する。
 * 既存の tt.lines があればタイミング情報を引き継ぐ。
 */
export function buildTimeTagLines(rebuildWaveformTagCache: () => void): void {
  if (!chart.lrcContent) return;
  const oldLines = tt.lines;

  // 既存ttLinesがある場合はタイムタグ付きLRCから再構築（ブロック境界を保持）
  const sourceLrc =
    oldLines.length > 0 && tt.lrcText.trim() ? tt.lrcText : chart.lrcContent;
  const newLines = buildTimeTagData(sourceLrc, chart.appliedChartReplContent);

  // タイムタグなしソースからの構築時のみタイミング引き継ぎが必要
  // タイムタグ付きソースなら buildTimeTagData が直接タイミングを復元する
  if (oldLines.length > 0 && sourceLrc === chart.lrcContent) {
    for (let li = 0; li < newLines.length && li < oldLines.length; li++) {
      const oldLine = oldLines[li];
      const newLine = newLines[li];
      if (oldLine.originalText !== newLine.originalText) continue;
      for (
        let ci = 0;
        ci < newLine.chars.length && ci < oldLine.chars.length;
        ci++
      ) {
        const oldCh = oldLine.chars[ci];
        const newCh = newLine.chars[ci];
        if (oldCh.char !== newCh.char) continue;
        for (
          let ti = 0;
          ti < newCh.checkCount && ti < oldCh.times.length;
          ti++
        ) {
          newCh.times[ti] = oldCh.times[ti];
        }
        newCh.endTime = oldCh.endTime;
      }
    }
  }

  tt.lines = newLines;
  if (oldLines.length === 0) {
    tt.cursorLine = 0;
    tt.cursorChar = 0;
    tt.cursorCheck = 0;
    tt.lastTaggedLine = -1;
    tt.lastTaggedChar = -1;
  }
  tt.undoStack = [{ type: "snapshot", data: JSON.stringify(newLines) }];
  tt.redoStack = [];
  tt.lastReplKey = chart.lrcContent + "\0" + chart.appliedChartReplContent;
  generateTtLrc();
  rebuildWaveformTagCache();
}

/**
 * Lyric タブの LRC テキスト (tt.lrcText) を tt.lines に同期する。
 * LRC テキストのタイミングを優先し、checkCount は古い tt.lines から引き継ぐ。
 */
export function syncLrcToTimeTagLines(
  rebuildWaveformTagCache: () => void,
): void {
  chart.lrcContent = tt.lrcText;
  const oldLines = tt.lines;
  const newLines = buildTimeTagData(tt.lrcText, chart.appliedChartReplContent);

  for (let li = 0; li < newLines.length && li < oldLines.length; li++) {
    const oldLine = oldLines[li];
    const newLine = newLines[li];
    if (oldLine.originalText !== newLine.originalText) continue;
    for (
      let ci = 0;
      ci < newLine.chars.length && ci < oldLine.chars.length;
      ci++
    ) {
      const oldCh = oldLine.chars[ci];
      const newCh = newLine.chars[ci];
      if (oldCh.char !== newCh.char) continue;
      newCh.checkCount = oldCh.checkCount;
    }
  }

  tt.lines = newLines;
  tt.lastReplKey = chart.lrcContent + "\0" + chart.appliedChartReplContent;
  rebuildWaveformTagCache();
}
