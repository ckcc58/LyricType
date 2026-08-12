/*
    受け取った譜面フォルダを整形して返す

    やり残してる事:
        ・lrcファイルが複数の場合どれを選ぶか選択できるようにする
        ・lrcファイルをこのサイト用の配列に変換する

    25/01/07 14時くらいから17時まで
        いい感じに作った
        つぎ:
            lyricをこのゲーム用に整形するコードを書く
            構想:
                行ごとに配列を分ける 行ごとに分けた中でスペースで区切る
                replTxtからルビを振っていく replTxtは返さないようにする
                ルビ振り用の専用の関数を作る（replTxtでそのまま使った場合だとひらがなにもルビが振られるからなんとかして処理する
*/

// encoding-japanese はファイル読み込み時のみ必要なので動的importする（バンドルサイズ削減）
import { ReplParser } from "./repl-parser";
import { hasTypeable, stripUntypeable, stripUntypeableChart, endsEnglishWord, startsEnglishWord, isWordSeparatorSpace, normalizeJoinChar } from "./char-class";


export type MediaSource = {
    type: "audio" | "video" | "youtube";
    label: string;
    url?: string;
    videoId?: string;
};

export type ParsedChart = {
    title: string, //フォルダ名から譜面のタイトルを取得する
    imageURL: string,
    media: { url: string, type: string, videoId?: string },
    availableSources: MediaSource[],
    lyric: {
        time: number;
        endTime: number;
        line: number;
        phrase: string;
        segments: { text: string; reading: string; normalizedText: string; normalizedReading: string; explicit: boolean; }[];
        matchRegExp: RegExp;
        charGroups: { count: number; startTime: number; endTime?: number }[];
    }[]
};

// files は FileList (input[type=file]) と File[] (ドロップ) の両方を受ける。
// 内部では Array.from でのみ扱うためどちらでも動く。
export async function parseChart(files: FileList | File[]): Promise<ParsedChart | undefined> {
    if (!files || files.length === 0) return;

    const lrcFile = Array.from(files).find(file => file.name.endsWith(".lrc"));
    const replTxtFile = Array.from(files).find(file => file.name.endsWith(".repl.txt"));
    const audioFile = Array.from(files).find(file => file.type.startsWith("audio/"));
    const videoFile = Array.from(files).find(file => file.type.startsWith("video/"));
    const imageFile = Array.from(files).find(file => file.type.startsWith("image/"));

    if (!lrcFile || !replTxtFile) return;

    // encoding-japanese を動的importする（初回ファイル読み込み時のみロード）
    const { default: Encoding } = await import("encoding-japanese");

    const readTxt = (file: File) => new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => {
            const arrayBuffer = reader.result as ArrayBuffer;
            const uint8Array = new Uint8Array(arrayBuffer);

            const detected = Encoding.detect(uint8Array);
            const text = Encoding.codeToString(Encoding.convert(uint8Array, "UFT8", detected));
            resolve(text);
        };
        reader.readAsArrayBuffer(file);
    })

    const title = files[0].webkitRelativePath.split("/")[0];
    const imageURL = imageFile ? URL.createObjectURL(imageFile) : "";

    const lrcTxtRaw = (await readTxt(lrcFile));

    // @ytid メタデータ抽出
    const ytidMatch = lrcTxtRaw.match(/@ytid=["']?([A-Za-z0-9_-]{11})["']?/);
    const ytVideoId = ytidMatch ? ytidMatch[1] : undefined;

    const lrcTxt = lrcTxtRaw.match(/\[\d\d:\d\d:\d\d\][\s\S]*\[\d\d:\d\d:\d\d\]/)?.[0] || "";

    // availableSources 構築
    const sources: MediaSource[] = [];
    if (audioFile) sources.push({ type: "audio", label: "音声+画像", url: URL.createObjectURL(audioFile) });
    if (videoFile) sources.push({ type: "video", label: "動画", url: URL.createObjectURL(videoFile) });
    if (ytVideoId) sources.push({ type: "youtube", label: "YouTube", videoId: ytVideoId });

    if (sources.length === 0) return;

    const replTxt = await readTxt(replTxtFile);

    const lrc = parseLyric(lrcTxt, replTxt);

    // デフォルトメディア: 最初のソース
    const defaultSource = sources[0];
    const media: { url: string; type: string; videoId?: string } = {
        url: defaultSource.url || "",
        type: defaultSource.type,
        ...(defaultSource.videoId ? { videoId: defaultSource.videoId } : {}),
    };

    return {
        title: title,
        imageURL: imageURL,
        media: media,
        availableSources: sources,
        lyric: lrc
    }
}

export function timeTagToTime(timeTag: string) {
    let [mm, ss, xx] = timeTag.replace(/[\[\]]/g, "").split(":");
    let time = +mm * 60 + +ss + +("0." + xx);
    return time;
}

export function timeToTimeTag(time: number): string {
    const totalCs = Math.round(time * 100);
    const mm = Math.floor(totalCs / 6000).toString().padStart(2, "0");
    const ss = Math.floor((totalCs % 6000) / 100).toString().padStart(2, "0");
    const xx = (totalCs % 100).toString().padStart(2, "0");
    return `[${mm}:${ss}:${xx}]`;
}

//01/20 7:51 次はここから書いていく
//tamerpmonkeyの[ニコタイ2たいつべ]から処理を引っ張ってたいつべ用のlyrics_arrayと同じ表記にする
//template: [time, lyric_kanji, lyric_kana ← 採点用のかな？]
/** 文字列を正規表現リテラルとして安全に使えるようエスケープする */
function escapeRegExpLiteral(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseLyric(lrc: string, replTxt: string) {
    const splitTag = "TYPIPPI_SPLIT_TAG";
    const splitReg = /([、。\s])/g;
    const timeTagRegex = /\[\d\d:\d\d:\d\d\]/;
    // 行末のタイムタグを検出するための正規表現
    const endTimeTagRegex = /\[\d\d:\d\d:\d\d\]$/;

    let replList = ReplParser.chart(replTxt);
    // 先頭タイムタグ検出用（連続する場合は最後がstartTime、それ以前は前フレーズのendTime）
    const leadingTagsRegex = /^(\s*\[\d\d:\d\d:\d\d\])+/;
    const singleTagRegex = /\[\d\d:\d\d:\d\d\]/g;
    // 英単語間の半角スペースは、日本語の句読点と同じくフレーズ区切りにする。
    // ただし打鍵対象の文字なので、区切りスペースは前フレーズの末尾に残したまま
    // 採点対象に含める (次のフレーズが英単語で始まるときのみ)。
    const allTagsRe = /\[\d\d:\d\d:\d\d\]/g;
    // 連結判定はダッシュ/空白の字種違いに左右されないよう正規化してから見る
    // ("Hi‐hi" の U+2010 などが混ざっていても ASCII の - と同じ扱いになる)
    const clauseText = (c: string) => normalizeJoinChar(c.replace(allTagsRe, ""));

    let lrcList = lrc.trim().split("\n").map(line => {
        // 1. スペース・句読点で分割
        const rawClauses = line.replace(splitReg, "$1" + splitTag).split(splitTag);

        // 1.5. 全文字が非打鍵な clause を隣接 clause に併合する（タイムタグは透過）。
        // 句読点後ろに残る非打鍵記号（例:「あいう。」の「」」、「you & me」の「& 」）が
        // フレーズとして単独残りすると、専用のプログレスバーが孤立して走るため、
        // 直前フレーズの末尾に取り込んで 1 フレーズとして扱う。
        const isAllNonTypable = (s: string) => {
            const stripped = s.replace(/\[\d\d:\d\d:\d\d\]/g, "");
            return stripped !== "" && !hasTypeable(stripped);
        };
        // 英単語間に単独で置かれたハイフン ("like - that" の "- ") は、
        // 併合せず 1 つの英単語と同じ扱いで独立フレーズにする。
        // 前後いずれかが英単語でなければ従来どおり併合される (日本語の "あ - い" 等)。
        const nonEmpty = rawClauses.filter((c) => c !== "");
        // ダッシュ/空白の字種違いに左右されないよう、正規化済みの本文で判定する
        const plainOf = (c: string) =>
            normalizeJoinChar(c.replace(/\[\d\d:\d\d:\d\d\]/g, ""));
        const isJoinWordClause = (i: number): boolean => {
            const text = plainOf(nonEmpty[i]);
            if (!/^[-\s]+$/.test(text)) return false;
            if (!text.includes("-")) return false;
            // 前後の実テキストを持つ clause を探して英単語か確認する
            let prev = "";
            for (let j = i - 1; j >= 0; j--) {
                const t = plainOf(nonEmpty[j]);
                if (t.trim() !== "") { prev = t; break; }
            }
            let next = "";
            for (let j = i + 1; j < nonEmpty.length; j++) {
                const t = plainOf(nonEmpty[j]);
                if (t.trim() !== "") { next = t; break; }
            }
            return endsEnglishWord(prev) && startsEnglishWord(next);
        };
        const joinWordSet = new Set(
            nonEmpty.filter((_, i) => isJoinWordClause(i)),
        );
        const clauses: string[] = [];
        for (const c of nonEmpty) {
            if (
                clauses.length > 0 &&
                isAllNonTypable(c) &&
                !/^\s+$/.test(c) &&
                !joinWordSet.has(c)
            ) {
                clauses[clauses.length - 1] += c;
            } else {
                clauses.push(c);
            }
        }
        // 行頭が非打鍵 clause の場合は次の clause に併合する（純粋な空白は独立させる）
        if (clauses.length >= 2 && isAllNonTypable(clauses[0]) && !/^\s+$/.test(clauses[0])) {
            clauses[1] = clauses[0] + clauses[1];
            clauses.shift();
        }

        // 2. 各フレーズから startTime と endTime を個別に検出
        let lastKnownTime = NaN;
        let prevEndTimeSetter: ((t: number) => void) | null = null;
        // 末尾の区切り (スペース / ハイフン混じり) が打鍵対象なら、その文字列を返す。
        // "I " → " " 、"like - " → " - "。対象外なら "" を返す。
        // 空フレーズ (タイムタグのみ) は読み飛ばして次の実テキストを見る。
        const trailingJoin = (ci: number): string => {
            const text = clauseText(clauses[ci]);
            // ハイフン単独フレーズ ("- "): 全体をそのまま採点対象にする
            if (joinWordSet.has(clauses[ci])) {
                return normalizeJoinChar(text).replace(/ +/g, " ");
            }
            if (!isWordSeparatorSpace(text.slice(-1))) return "";
            const run = text.match(/[\s\-]+$/);
            if (!run) return "";
            if (!endsEnglishWord(text.slice(0, text.length - run[0].length))) return "";
            for (let j = ci + 1; j < clauses.length; j++) {
                const next = clauseText(clauses[j]);
                if (next.trim() === "") continue;
                // 次がハイフン単独フレーズなら英単語と同じ扱い
                if (joinWordSet.has(clauses[j]) || startsEnglishWord(next)) {
                    return normalizeJoinChar(run[0]).replace(/ +/g, " ");
                }
                return "";
            }
            return "";
        };

        return clauses.map((data, ci) => {
            const keepTrailingSpace = trailingJoin(ci);
            // 先頭の連続タイムタグを検出
            const leadingMatch = data.match(leadingTagsRegex);
            let startTime = NaN;
            if (leadingMatch) {
                const tags = leadingMatch[0].match(singleTagRegex)!;
                // 最後のタグがstartTime、それ以前は前フレーズのendTime
                startTime = timeTagToTime(tags[tags.length - 1]);
                if (tags.length >= 2 && prevEndTimeSetter) {
                    prevEndTimeSetter(timeTagToTime(tags[tags.length - 2]));
                }
            }

            // 末尾のタイムタグ → endTime（先頭タグとは別のものだけ）
            let endTime: number | undefined;
            const trimmed = data.trim();
            const endMatch = trimmed.match(endTimeTagRegex);
            if (endMatch) {
                const endVal = timeTagToTime(endMatch[0]);
                // 先頭タグと同一でなければendTime
                if (isNaN(startTime) || endVal !== startTime) {
                    endTime = endVal;
                }
            }

            // タイムタグを全て除去してテキストだけ残す
            let clause = data.replace(new RegExp(timeTagRegex, "g"), "");

            // startTimeがない場合、直前のtimeを継承
            if (!isNaN(startTime)) {
                lastKnownTime = startTime;
            } else {
                startTime = lastKnownTime;
            }

            // 文字グループ抽出: タイムタグをスキャンし、タグ間の文字数をグループとして記録
            const charGroups: { count: number; startTime: number; endTime?: number }[] = [];
            {
                const inlineTagRe = /\[(\d{2}:\d{2}:\d{2})\]/g;
                let curTime = startTime;
                let curCount = 0;
                let lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = inlineTagRe.exec(data)) !== null) {
                    curCount += m.index - lastIndex;
                    if (curCount > 0) {
                        charGroups.push({ count: curCount, startTime: curTime });
                        curCount = 0;
                    } else if (charGroups.length > 0) {
                        // 連続タイムタグ（文字なし）: 直前グループのendTimeに設定
                        charGroups[charGroups.length - 1].endTime = curTime;
                    }
                    curTime = timeTagToTime(m[1]);
                    lastIndex = m.index + m[0].length;
                }
                curCount += data.length - lastIndex;
                if (curCount > 0) charGroups.push({ count: curCount, startTime: curTime });
            }

            // 打鍵対象外のスペースをプログレスバー（火花）の対象から除外する。
            // スペースは発音していないためバーが伸びると違和感がある。また count に
            // 含めると、その分だけバー先端が可視文字の末尾で止まる前に「時間」を消費し、
            // スペース比率の高い短いフレーズほど火花が早く終わる原因になる。
            // 併合クローズ ("like - ") では末尾以外にも空白が入るため、タグを除いた
            // 全空白を数え、打鍵対象の区切り (keepTrailingSpace) に含まれる空白の
            // 数だけ戻す。超過分は末尾側のグループから順に引く。
            {
                const plain = data.replace(/\[\d\d:\d\d:\d\d\]/g, "");
                const wsCount = (plain.match(/[\s　]/g) ?? []).length;
                let excess =
                    wsCount - (keepTrailingSpace.match(/ /g)?.length ?? 0);
                for (let gi = charGroups.length - 1; gi >= 0 && excess > 0; gi--) {
                    const take = Math.min(excess, charGroups[gi].count);
                    charGroups[gi].count -= take;
                    excess -= take;
                    if (charGroups[gi].count <= 0) charGroups.splice(gi, 1);
                }
            }

            const result = [startTime, clause, endTime, charGroups, keepTrailingSpace] as [number, string, number | undefined, { count: number; startTime: number; endTime?: number }[], string];
            // 次のフレーズが先頭連続タグでendTimeを設定できるようにする
            prevEndTimeSetter = (t: number) => { result[2] = result[2] ?? t; };
            return result;
        }).filter((data, idx, arr) => {
            // 句読点分割で生じた「タイムタグのみ・テキスト空」フレーズの時刻を前フレーズのendTimeに使う
            if (!isNaN(data[0]) && data[1] === "") {
                for (let j = idx - 1; j >= 0; j--) {
                    if (arr[j][1] !== "" && !isNaN(arr[j][0])) {
                        arr[j][2] = arr[j][2] ?? data[0];
                        break;
                    }
                }
            }
            return !isNaN(data[0]) && data[1] !== "";
        });
    }).map(clauseData => {
        //配列内の歌詞部分にルビ振り出来るならルビ振りして返す
        return clauseData.map(data => {
            let clause = data[1];
            for (let i = 0; i < replList.length; i++) {
                // repl のキーは「文字列そのもの」として置換する。エスケープしないと
                // 正規表現のメタ文字 (?, *, +, ( ) など) を含むキーで例外になり
                // 譜面全体が読み込めなくなる。
                // (例: SJIS 保存で ♡ が "?" に化けたキー "?は不格好" → Nothing to repeat)
                clause = fixRuby(clause.replace(new RegExp(escapeRegExpLiteral(replList[i][0]), "g"), replList[i][1]));
            }
            return [data[0], clause, data[2] /* endTime */, data[3] /* charGroups */, data[4] /* keepTrailingSpace */] as [number, string, number | undefined, { count: number; startTime: number; endTime?: number }[], string]
        })
    }).map((line, i) => {
        return line.map(phraseData => {
            let time = phraseData[0];
            let phrase = phraseData[1];
            let endTime = phraseData[2];
            let charGroups = phraseData[3];
            const keepTrailingSpace = phraseData[4];

            let segments: { text: string; reading: string; normalizedText: string; normalizedReading: string; explicit: boolean; }[] = [];
            const parts = phrase.split(/(<ruby>[\s\S]*?<\/ruby>)/g);

            const buildSegment = (text: string, reading: string, explicit = false) => {
                // 英文の半角スペース・' は打鍵対象として残す ("I love you" / "don't")
                const normalizedText = stripUntypeableChart(text);
                let tempReading = stripUntypeableChart(reading);
                tempReading = tempReading.replace(/[\u30a1-\u30f6]/g, match => String.fromCharCode(match.charCodeAt(0) - 0x60));
                // \uff5e \u306f\u8aad\u307f\u3067\u306f \u30fc\uff08\u9577\u97f3\uff09\u3068\u3057\u3066\u6253\u3066\u308b\u3088\u3046\u6b63\u898f\u5316\uff08\u30bf\u30a4\u30d7\u6642\u306f \uff5e \u3067 text \u30de\u30c3\u30c1\u3001\u30fc \u3067 reading \u30de\u30c3\u30c1\uff09
                tempReading = tempReading.replace(/[\uff5e\u301c]/g, "\u30fc");
                const normalizedReading = tempReading.toLowerCase();
                segments.push({ text, reading, normalizedText, normalizedReading, explicit });
            };

            // plain text \u3092\u6f22\u5b57/\u975e\u6f22\u5b57\u5883\u754c\u3067\u5206\u5272\u3057\u3066\u5225\u30bb\u30b0\u30e1\u30f3\u30c8\u306b\u3059\u308b
            const splitPlainText = (plain: string) => {
                const kanjiRe = /[\u4e00-\u9fff]/;
                let i = 0;
                while (i < plain.length) {
                    const isKanji = kanjiRe.test(plain[i]);
                    let j = i;
                    while (j < plain.length && kanjiRe.test(plain[j]) === isKanji) j++;
                    buildSegment(plain.slice(i, j), plain.slice(i, j), false);
                    i = j;
                }
            };

            parts.forEach(part => {
                if (part === "") return;

                const rubyMatch = part.match(/<ruby>([\s\S]*?)<rt>([\s\S]*?)<\/rt><\/ruby>/);
                if (rubyMatch) {
                    buildSegment(rubyMatch[1], rubyMatch[2], true);
                } else {
                    splitPlainText(part);
                }
            });

            // 英単語の区切りスペースを採点対象に戻す。
            // stripUntypeableChart はセグメント内しか見えず「次に単語が続くか」を
            // 判断できないため、フレーズ単位で判定した結果をここで反映する。
            if (keepTrailingSpace !== "" && segments.length > 0) {
                const last = segments[segments.length - 1];
                last.normalizedText += keepTrailingSpace;
                last.normalizedReading += keepTrailingSpace;
            }

            // 2. Create RegExp
            // Escape function for regex special characters
            const escapeRegExp = (string: string) => {
                return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
            };

            // Build pattern: ^(text|reading)(text|reading)...$
            let pattern = "^";
            segments.forEach(seg => {
                const pText = escapeRegExp(seg.normalizedText);
                const pRead = escapeRegExp(seg.normalizedReading);

                if (pText === pRead) {
                    pattern += `(${pText})`;
                } else {
                    pattern += `(${pText}|${pRead})`;
                }
            });
            // pattern += "$"; // Allow prefix match for continuous input
            const matchRegExp = new RegExp(pattern);

            return {
                time: time as number,
                endTime: endTime !== undefined ? endTime : 0,
                line: i as number,
                phrase: phrase as string,
                segments: segments,
                matchRegExp: matchRegExp,
                charGroups: charGroups as { count: number; startTime: number; endTime?: number }[]
            }
        })
    }).flat().sort((a, b) => a.time - b.time);

    // Calculate endTime
    for (let i = 0; i < lrcList.length; i++) {
        if (lrcList[i].endTime !== 0) {
            continue;
        }

        if (i < lrcList.length - 1) {
            lrcList[i].endTime = lrcList[i + 1].time;
        } else {
            // Last one
            lrcList[i].endTime = lrcList[i].time + 10; // Default +10s or song end
        }
    }

    // 甘いLRC補完: endTime <= time のphrase（同じtimeの連続phraseで
    // プログレスバーの範囲が無い状態）に対し、後方のphraseのendTimeを借りて統一する
    for (let i = 0; i < lrcList.length; i++) {
        if (lrcList[i].endTime <= lrcList[i].time) {
            for (let j = i + 1; j < lrcList.length; j++) {
                if (lrcList[j].endTime > lrcList[i].time) {
                    lrcList[i].endTime = lrcList[j].endTime;
                    break;
                }
            }
        }
    }

    return lrcList;
}

//ルビ振りの重複削除（repl適用後のネスト解消用）
//ネストした <ruby> の内側を base text のみに展開する（正規表現ベース、SSR対応）
function fixRuby(text: string) {
    let prev = '';
    while (prev !== text) {
        prev = text;
        // 外側の <ruby> 内にある内側の <ruby>X<rt>Y</rt></ruby> を X に置換
        text = text.replace(
            /(<ruby>(?:(?!<\/ruby>)[\s\S])*?)<ruby>((?:(?!<ruby>)[\s\S])*?)<rt>[\s\S]*?<\/rt><\/ruby>/g,
            '$1$2'
        );
    }
    return text;
}
