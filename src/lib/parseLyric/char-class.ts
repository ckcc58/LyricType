/**
 * 打鍵対象になる文字クラスの単一定義。
 *
 * このゲームで「タイプして消せる文字」= 数字(半角/全角)・英字(半角/全角)・
 * ひらがな・カタカナ(長音符ー含む)・々〆・漢字・波ダッシュ(～〜)。
 *
 * 従来 chart-game.ts / parse-chart.ts / GameOverlay.svelte に同一の正規表現が
 * コピペされていたため、ここに集約する。
 *
 * ⚠️ TYPEABLE_CHARS は「正規表現の文字クラス [...] の中身」として使う前提の断片。
 *    文字を追加するときは、文字クラス内で特別な意味を持つ `-` `]` `^` `\` を
 *    そのまま入れないこと（範囲指定やクラス終端と誤解釈され壊れる）。
 *    追加する場合はエスケープするか、範囲(例 ぁ-ん)の形で書くこと。
 */
export const TYPEABLE_CHARS = "0-9０-９a-zA-Zａ-ｚＡ-Ｚぁ-んァ-ヶー々〆一-鿿～〜";

// ホットパス（入力ごと checkInput/handleInput、文字単位の GameOverlay レンダー）から
// 呼ばれるため、RegExp は毎回生成せずモジュール内でキャッシュする。
// - TYPEABLE_RE は non-global。.test() で使い回しても lastIndex が進まず安全。
// - UNTYPEABLE_RE は global。.replace() でのみ使う想定で、.replace は毎回 lastIndex を
//   リセットするため共有しても安全（.test() で使うと lastIndex が進み壊れるので使わない）。
const TYPEABLE_RE = new RegExp(`[${TYPEABLE_CHARS}]`);
const UNTYPEABLE_RE = new RegExp(`[^${TYPEABLE_CHARS}]`, "g");

/** 文字列が1つでも打鍵可能文字を含むか */
export function hasTypeable(s: string): boolean {
  return TYPEABLE_RE.test(s);
}

/** 打鍵不能な文字をすべて除去する */
export function stripUntypeable(s: string): string {
  return s.replace(UNTYPEABLE_RE, "");
}

// ============================================================
// 英文の半角スペース・アポストロフィ
// ============================================================
//
// 英文では単語間の半角スペース・"don't" の '・"Hi-hi" "like - that" のハイフンも打鍵対象にする。
// 日本語間のスペースは従来どおり対象外なので TYPEABLE_CHARS には足さず、
// 「半角英数字に挟まれているときだけ残す」文脈付きの関数を別に用意する。
//
// ’ ‘ (曲線アポストロフィ) は打鍵できる ' に正規化してから扱う。

/** 英単語の構成文字とみなす範囲。全角英数字は対象外 */
export const WORD_CHAR_RE = /[a-zA-Z0-9]/;
/** 単語の一部として振る舞う文字 (英数字 + アポストロフィ) */
const WORDISH_RE = /[a-zA-Z0-9']/;
/** 単語をつなぐ文字の連なり (半角スペース + ハイフン)。"like - that" のように混在する */
const JOIN_RUN_RE = /[ \-]+/g;
/**
 * 単語の末尾に付く半角記号・空白・ハイフン。連結判定ではこれを読み飛ばす。
 * ("you, and" / "Hey! you" / "like - that" など)
 */
const TRAILING_PUNCT_RE = /[\s,.!?;:'’")\]}\-]+$/;
/** 単語の先頭に付く半角記号・空白 ("'Cause" / "(Hey" / "-that") */
const LEADING_PUNCT_RE = /^[\s'‘"(\[{\-]+/;

const APOS_VARIANTS_RE = /[’‘]/g;
/**
 * 半角スペースと同一視する空白。
 * NBSP(U+00A0) や全角スペースは見た目で区別できず歌詞ファイルに紛れ込むため、
 * 「英単語の区切り」判定・打鍵対象判定の前に半角スペースへ寄せる。
 */
const SPACE_VARIANTS_RE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
/**
 * 半角ハイフン (U+002D) と同一視するダッシュ類。
 * 見た目でほぼ区別できず歌詞ファイルに紛れ込むため、打鍵対象判定の前に寄せる。
 * ※ 長音符 ー (U+30FC) は日本語の打鍵対象文字なので含めないこと。
 */
const DASH_VARIANTS_RE = /[\u2010-\u2015\u2212\uff0d]/g;
// 除去対象から半角スペース・'・ハイフンを除いた版 (g。.replace 専用)
const UNTYPEABLE_KEEP_JOIN_RE = new RegExp(`[^${TYPEABLE_CHARS} '\\-]`, "g");

/** 表示文字を normalizedText と突き合わせるための 1 文字正規化 */
export function normalizeJoinChar(c: string): string {
  return c
    .replace(APOS_VARIANTS_RE, "'")
    .replace(SPACE_VARIANTS_RE, " ")
    .replace(DASH_VARIANTS_RE, "-");
}

/** 英単語の区切りになりうる空白か (改行以外の空白すべて) */
export function isWordSeparatorSpace(c: string): boolean {
  return /[^\S\r\n]/.test(c);
}

/** 境界に接している語のかたまり ("big," → "big" / "5!" → "5") */
const TRAILING_WORD_RE = /[a-zA-Z0-9']+$/;
const LEADING_WORD_RE = /^[a-zA-Z0-9']+/;
/**
 * 語として英字を含むか。
 * "5! 4! 3! 2! HOWL!" のような数字だけのかたまりは英単語とみなさず、
 * 間のスペースを打鍵対象にしない ("R2D2" のように英字が混ざるものは英単語)。
 */
const HAS_LETTER_RE = /[a-zA-Z]/;

/** 区切りスペースの前側が英単語の末尾か (カンマ・ドット・' は読み飛ばす) */
export function endsEnglishWord(s: string): boolean {
  const word = s.replace(TRAILING_PUNCT_RE, "").match(TRAILING_WORD_RE);
  return !!word && HAS_LETTER_RE.test(word[0]);
}

/** 区切りスペースの後側が英単語の先頭か (先頭の ' は読み飛ばす) */
export function startsEnglishWord(s: string): boolean {
  const word = s.replace(LEADING_PUNCT_RE, "").match(LEADING_WORD_RE);
  return !!word && HAS_LETTER_RE.test(word[0]);
}

/**
 * 譜面テキスト用: 英文の半角スペース・' を残して打鍵不能文字を除去する。
 *
 * - ' は前後どちらかが半角英数字なら残す ("don't" / "'Cause" / "dreamin'")
 * - 半角スペース・ハイフンの連なりは前後が単語 (英数字か ') のときだけ残す
 *   ("Hi-hi" / "like - that")。連続スペースは 1 つに潰す
 */
export function stripUntypeableChart(s: string): string {
  const base = normalizeJoinChar(s).replace(UNTYPEABLE_KEEP_JOIN_RE, "");

  // 1) 英数字に隣接しない ' を落とす
  const withApos = base.replace(/'+/g, (m, off: number) => {
    const prev = base[off - 1] ?? "";
    const next = base[off + m.length] ?? "";
    return WORD_CHAR_RE.test(prev) || WORD_CHAR_RE.test(next) ? "'" : "";
  });

  // 2) 単語に挟まれていないスペース/ハイフンの連なりを落とす
  //    (残った ' は単語の一部として扱う)
  return withApos.replace(JOIN_RUN_RE, (m, off: number) => {
    const prev = withApos[off - 1] ?? "";
    const next = withApos[off + m.length] ?? "";
    if (!WORDISH_RE.test(prev) || !WORDISH_RE.test(next)) return "";
    return m.replace(/ +/g, " ");
  });
}

/**
 * プレイヤー入力用: スペースと ' は無条件に残す。
 *
 * 入力途中は「次に何を打つか」がまだ無いため、譜面側と同じ文脈判定はできない。
 * 打つべき位置のスペースかどうかはマッチング側 (matchSegment) が判断し、
 * 合わないスペースは他の誤字と同じく一致しない = 誤打になる。
 * 全角スペースは半角に寄せる (英数字の全角/半角を同一視する既存方針に合わせる)。
 */
export function stripUntypeableInput(s: string): string {
  return normalizeJoinChar(s).replace(UNTYPEABLE_KEEP_JOIN_RE, "");
}

// 1 文字判定用 (非g)。UNTYPEABLE_KEEP_JOIN_RE は g なので .test では使えない
const UNTYPEABLE_KEEP_JOIN_TEST = new RegExp(`[^${TYPEABLE_CHARS} '\\-]`);

/**
 * stripUntypeableInput と同じ結果に加え、除去後の各文字が元の文字列の
 * どの位置だったかの対応表を返す。
 *
 * 内部処理は正規化後の文字列で行いつつ、入力欄へ書き戻すときは元の文字
 * (記号・全角・曲線アポストロフィ) をそのまま復元するために使う。
 * normalizeJoinChar は 1 文字 → 1 文字の置換なので位置は変わらない。
 */
export function stripUntypeableInputWithMap(s: string): {
  text: string;
  map: number[];
} {
  const norm = normalizeJoinChar(s);
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < norm.length; i++) {
    if (UNTYPEABLE_KEEP_JOIN_TEST.test(norm[i])) continue;
    text += norm[i];
    map.push(i);
  }
  return { text, map };
}

/**
 * かな文字クラス（ひらがな・カタカナ・長音符ー）。
 *
 * 「この文字はかなか」「かな以外を除去」といった判定で repl-parser / timetag-parser /
 * optimize が同じ集合を使っていたため共有する。
 * ※ ァ-ヶ は U+30A1..U+30F6 で ヴヵヶ も含む。ー(U+30FC)はその外なので別途追加している。
 * ※ difficulty.ts の「ひらがな/カタカナ分類」はバケツ分け用途で意図的に ぁ-ん 等へ絞っており、
 *    こちらの共有集合とは別物（統合しないこと）。
 */
export const KANA_CHARS = "ぁ-んァ-ヶー";

const KANA_RE = new RegExp(`[${KANA_CHARS}]`); // 非g。.test で共有安全
const NON_KANA_RE = new RegExp(`[^${KANA_CHARS}]`, "g"); // g。.replace 専用

/** 文字列がかなを含むか（1文字に使えば「その文字がかなか」の判定） */
export function isKana(s: string): boolean {
  return KANA_RE.test(s);
}

/** かな以外の文字をすべて除去する */
export function stripNonKana(s: string): string {
  return s.replace(NON_KANA_RE, "");
}
