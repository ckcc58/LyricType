// LRC 出力用シリアライズ (behavior: state 読み取りあり、副作用なし)
import { chart } from "../../_state/chart.svelte";
import { tt } from "../../_state/timetag.svelte";
import { player } from "../../_state/player.svelte";

/** 現在の状態から有効な @ytid を返す (YouTube モード優先) */
function currentYtId(): string {
  return player.audioMode === "youtube" && player.ytVideoId
    ? player.ytVideoId
    : chart.lrcYtId;
}

/**
 * ファイル/フォルダ保存用 LRC を生成する。
 * 読み込み時に保持したヘッダ/フッタ (@Ruby・[ti:]・クレジット行等のメタ情報) を
 * 無解釈のまま復元し、本体だけを再生成した内容で差し替える。
 * `@ytid` はヘッダ内に既存行があればその行を更新し、無ければ先頭に追加する。
 */
export function getLrcForSave(): string {
  let header = chart.lrcHeader;
  const ytid = currentYtId();
  if (ytid) {
    const line = `@ytid="${ytid}"`;
    if (/^@ytid=/m.test(header)) {
      header = header.replace(/^@ytid=[^\n]*/m, line);
    } else {
      header = header ? line + "\n" + header : line;
    }
  }
  // header / footer は境界の改行を含まない形で保持しているのでここで付け直す
  const headerPart = header ? header + "\n" : "";
  const footerPart = chart.lrcFooter ? "\n" + chart.lrcFooter : "";
  let body = tt.lrcText;
  // 再生成本体は末尾改行を持つ。フッタの先頭改行と重なって空行にならないよう除去
  if (body.endsWith("\n") && footerPart.startsWith("\n")) {
    body = body.slice(0, -1);
  }
  return headerPart + body + footerPart;
}

/**
 * DB 投稿用 LRC を生成する (従来形式)。
 * ヘッダ/フッタは含めず `@ytid` ディレクティブ + 本体のみ。
 */
export function getLrcForSubmit(): string {
  const ytid = currentYtId();
  const directives = ytid ? `@ytid="${ytid}"\n` : "";
  return directives + tt.lrcText;
}
