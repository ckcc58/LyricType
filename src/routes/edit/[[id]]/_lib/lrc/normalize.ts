// 外部 LRC 方言のタイムタグを本形式 [mm:ss:xx] (コロン・センチ秒) へ正規化する。
// 読み込み境界 (loadFromFiles) でのみ適用し、下流は常に本形式だけを扱う。
//
// 対応 (変換する):
//   [mm:ss.xx]  ドット・センチ秒 (標準 LRC の主流形)
//   [mm:ss.xxx] ドット・ミリ秒 (センチ秒へ四捨五入)
//   <mm:ss.xx> / <mm:ss.xxx> / <mm:ss:xx>  A2 拡張の単語タグ (角括弧へ)
//     → 変換結果は「単語頭にタグ」となり、既存の英単語タグ付けと同じ構造に落ちる
//
// 非対応 (素通し・意図的):
//   [mm:ss]     小数省略
//   [m:s.x]     桁ゆれ
//   [mm:ss:xxx] コロン3桁端数 (どの方言にも属さず曖昧)
//   hh:mm:ss 解釈 (本形式と見た目が同一で判別不能。コロン3分割=センチ秒で固定)

/** ドット端数 (2〜3桁) をセンチ秒2桁文字列へ */
function fracToCs(frac: string): string {
  const cs = Math.min(99, Math.round(Number("0." + frac) * 100));
  return String(cs).padStart(2, "0");
}

/** メタ行判定: @ディレクティブ (@ytid / @Ruby 等) または [ti:] 等の ID タグのみの行 */
function isMetaLine(line: string): boolean {
  return /^@/.test(line) || /^\[[a-zA-Z][^\]\n]*\][ \t]*$/.test(line);
}
function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

/**
 * LRC を行分類で「ヘッダ / 本体 / フッタ」に3分割する。
 * メタ行 (@行・ID タグ行) を抜き出し、残り全てを歌詞本体とする方式。
 * タイムタグの有無・位置に関係なく歌詞行は常に本体に入る
 * (タグ付け途中のファイルでも後半の歌詞が編集対象から消えない)。
 *
 * - ヘッダ: 先頭に連続するメタ行・空行
 * - フッタ: 末尾に連続するメタ行・空行 + 本体途中に紛れたメタ行 (端へ退避、内容は保持)
 * - 本体: それ以外すべて (タグ付き/タグ無しの歌詞行、連間の空行)
 * ヘッダ・フッタは無解釈のまま保持し、保存時にそのまま復元する。
 *
 * 返す header / footer は本体との境界の改行を含まない (行の集合そのもの)。
 * 境界の改行は保存時 (getLrcForSave) に付け直す。こうすることで
 * エディタでそのまま編集させても余分な空行が見えない。
 */
export function splitLrcSections(raw: string): {
  header: string;
  body: string;
  footer: string;
} {
  const lines = raw.split("\n");

  // 本体の範囲 = 最初と最後の「歌詞行 (メタでも空でもない行)」
  let first = -1;
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isMetaLine(lines[i]) && !isBlankLine(lines[i])) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) {
    // 歌詞行なし (メタ・空行のみ): 全てヘッダとして保持
    return { header: raw.replace(/\n$/, ""), body: "", footer: "" };
  }

  const headerLines = lines.slice(0, first);
  const midMeta: string[] = [];
  const bodyLines: string[] = [];
  for (let i = first; i <= last; i++) {
    if (isMetaLine(lines[i])) midMeta.push(lines[i]);
    else bodyLines.push(lines[i]);
  }
  const trailing = lines.slice(last + 1);
  const footerLines = [...midMeta, ...trailing];

  return {
    header: headerLines.join("\n"),
    body: bodyLines.join("\n"),
    footer: footerLines.join("\n"),
  };
}

export function normalizeLrcTimeTags(lrc: string): string {
  return (
    lrc
      // [mm:ss.xx] / [mm:ss.xxx] → [mm:ss:cc]
      .replace(
        /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g,
        (_, mm, ss, f) => `[${mm}:${ss}:${fracToCs(f)}]`,
      )
      // A2: <mm:ss.xx> / <mm:ss.xxx> → [mm:ss:cc]
      .replace(
        /<(\d{2}):(\d{2})\.(\d{2,3})>/g,
        (_, mm, ss, f) => `[${mm}:${ss}:${fracToCs(f)}]`,
      )
      // A2 でコロン・センチ秒表記だった場合も角括弧へ
      .replace(/<(\d{2}):(\d{2}):(\d{2})>/g, "[$1:$2:$3]")
  );
}
