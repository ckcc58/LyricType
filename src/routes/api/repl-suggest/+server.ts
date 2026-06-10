import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  GOOGLE_API_KEY,
  UPSTASH_REDIS_REST_TOKEN,
  UPSTASH_REDIS_REST_URL,
} from "$env/static/private";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import kuromoji from "kuromoji";
import path from "path";
import { ReplParser } from "$lib/parseLyric/repl-parser";

const ratelimit = new Ratelimit({
  redis: new Redis({
    url: UPSTASH_REDIS_REST_URL,
    token: UPSTASH_REDIS_REST_TOKEN,
  }),
  limiter: Ratelimit.slidingWindow(3, "30 s"),
  ephemeralCache: new Map(),
});

const PROMPT_TEMPLATE = `あなたは日本語歌詞の漢字読みを生成するツールです。

【鉄則: 入力文字数 = セグメント数】
必ず入力単語の文字数を数えてから、ちょうどその数のセグメントを作る。
読みのひらがな数は関係ない。

色彩(2文字) → セグメント2個 → 色彩,しき|さい
彩ら(2文字) → セグメント2個 → 彩ら,いろど|ら
繰り返す(4文字) → セグメント4個 → 繰り返す,く|り|かえ|す

【その他ルール】
- 読みはひらがなのみ（カタカナ語のみカタカナ可）
- 漢字を読みにそのままコピー禁止
- 漢字を含まない単語は出力しない
- 熟字訓はパイプなし: 今日,きょう
- 前置き・解説なし、1単語1行

【禁止例】
色彩,し|き|さ|い → 色彩,しき|さい  (2文字→4セグは禁止)
彩ら,いろ|ど|ら → 彩ら,いろど|ら  (2文字→3セグは禁止)
歌う,歌|う → 歌う,うた|う  (漢字コピー禁止)

入力単語:
{{phrases}}

出力:`;

type KuromojiTokenizer = kuromoji.Tokenizer<kuromoji.IpadicFeatures>;
let tokenizerCache: KuromojiTokenizer | null = null;

function getTokenizer(): Promise<KuromojiTokenizer> {
  if (tokenizerCache) return Promise.resolve(tokenizerCache);
  return new Promise((resolve, reject) => {
    kuromoji
      .builder({
        dicPath: path.join(process.cwd(), "node_modules/kuromoji/dict"),
      })
      .build((err, tokenizer) => {
        if (err) {
          reject(err);
          return;
        }
        tokenizerCache = tokenizer;
        resolve(tokenizer);
      });
  });
}

function extractPhrasesWithKuromoji(
  tokenizer: KuromojiTokenizer,
  text: string,
  missingChars: Set<string>,
): string[] {
  const tokens = tokenizer.tokenize(text);
  // kuromojiが1文字単独トークンとして切り出した位置セット(0-indexed)
  const singleTokenPositions = new Set<number>(
    tokens
      .filter((t) => t.surface_form.length === 1)
      .map((t) => t.word_position - 1),
  );

  const result = new Set<string>();
  const consumed = new Set<number>();

  for (const token of tokens) {
    const pos = token.word_position - 1;
    if (consumed.has(pos)) continue;

    let surface = token.surface_form;
    // 1文字だけの漢字トークンは、直後の文字を結合
    // ひらがな・カタカナは無条件、漢字はkuromojiが単独トークンとして出した場合のみ
    if (/^[一-鿿々〆]$/.test(surface)) {
      const nextPos = pos + 1;
      const nextChar = text[nextPos];
      if (nextChar) {
        const isHiraKata = /^[ぁ-んァ-ン]$/.test(nextChar);
        const isKanjiToken =
          /^[一-鿿々〆]$/.test(nextChar) && singleTokenPositions.has(nextPos);
        if (isHiraKata || isKanjiToken) {
          surface = surface + nextChar;
          consumed.add(nextPos);
        }
      }
    }

    if ([...surface].some((c) => missingChars.has(c))) {
      result.add(surface);
    }
  }
  return [...result];
}

function extractPhrasesFallback(text: string, missingChars: Set<string>): string[] {
  const result = new Set<string>();
  const phraseRegExp = /[一-鿿々〆ぁ-んァ-ンー]+/g;
  for (const match of text.matchAll(phraseRegExp)) {
    const phrase = match[0];
    if ([...phrase].some((c) => missingChars.has(c))) {
      result.add(phrase);
    }
  }
  return [...result];
}

function postProcessRepl(replText: string): string {
  return replText
    .split("\n")
    .map((line) => {
      const commaIdx = line.indexOf(",");
      if (commaIdx === -1) return line;
      const word = line.slice(0, commaIdx);
      const reading = line.slice(commaIdx + 1);
      const wordLen = [...word].length;
      const segments = reading.split("|");

      if (segments.length === wordLen) return line;

      // パイプ数が合わない → 読みをフラット化して ReplParser.migrate で再計算
      const flat = segments.join("");
      const migrated = ReplParser.migrate(`${word},${flat}`);
      const migratedComma = migrated.indexOf(",");
      if (migratedComma === -1) return line;
      const newReading = migrated.slice(migratedComma + 1);
      return [...newReading.split("|")].length === wordLen
        ? `${word},${newReading}`
        : line;
    })
    .join("\n");
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ error: "ログインが必要です" }, { status: 401 });
  }

  const rateLimitKey = String(locals.profile?.id ?? locals.user.id);
  const { success } = await ratelimit.limit(rateLimitKey);
  if (!success) {
    return json(
      { error: "リクエストが多すぎます。しばらく待ってから再試行してください" },
      { status: 429 },
    );
  }

  let body: { phrases?: string[]; lrcText?: string; missingChars?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "無効なリクエスト" }, { status: 400 });
  }

  let phrases: string[];

  if (body.lrcText && body.missingChars?.length) {
    const missingSet = new Set(body.missingChars);
    try {
      const tokenizer = await getTokenizer();
      phrases = extractPhrasesWithKuromoji(
        tokenizer,
        body.lrcText,
        missingSet,
      ).filter((p) => /[一-鿿々〆]/.test(p));
    } catch (err) {
      console.warn("kuromoji unavailable, using fallback extraction:", err);
      phrases = extractPhrasesFallback(body.lrcText, missingSet).filter((p) =>
        /[一-鿿々〆]/.test(p),
      );
    }
  } else {
    phrases = (body.phrases ?? []).filter((p) => /[一-鿿々〆]/.test(p));
  }

  if (phrases.length === 0) {
    return json({ repl: "" });
  }

  const google = createGoogleGenerativeAI({ apiKey: GOOGLE_API_KEY });
  const prompt = PROMPT_TEMPLATE.replace(
    "{{phrases}}",
    phrases.map((p) => `- ${p}`).join("\n"),
  );

  try {
    const { text, usage } = await generateText({
      model: google("gemini-2.5-flash"),
      prompt,
    });
    const repl = postProcessRepl(text.trim());
    return json({ repl, usage, phrases });
  } catch (err) {
    console.warn("Gemini Flash failed, falling back to Flash-Lite:", err);
    try {
      const { text, usage } = await generateText({
        model: google("gemini-2.5-flash-lite"),
        prompt,
      });
      const repl = postProcessRepl(text.trim());
      return json({ repl, usage, phrases });
    } catch (err2) {
      console.error("Gemini error:", err2);
      return json({ error: "生成に失敗しました" }, { status: 500 });
    }
  }
};
