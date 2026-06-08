// LRC 出力用シリアライズ (behavior: state 読み取りあり、副作用なし)
import { chart } from "../../_state/chart.svelte";
import { tt } from "../../_state/timetag.svelte";
import { player } from "../../_state/player.svelte";

/**
 * 現在の state から保存用 LRC テキストを生成する。
 * `@ytid="..."` ディレクティブを必要に応じて付加する。
 */
export function getLrcForSave(): string {
  let directives = "";
  const ytid =
    player.audioMode === "youtube" && player.ytVideoId
      ? player.ytVideoId
      : chart.lrcYtId;
  if (ytid) directives += `@ytid="${ytid}"\n`;
  return directives + tt.lrcText;
}
