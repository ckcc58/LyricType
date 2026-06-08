import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GOOGLE_API_KEY, YOUTUBE_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } from '$env/static/private';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';

const ratelimit = new Ratelimit({
	redis: new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN }),
	limiter: Ratelimit.slidingWindow(1, '5 s'),
	ephemeralCache: new Map()
});

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.profile) {
		return json({ error: 'ログインが必要です' }, { status: 401 });
	}

	const { videoId } = params;
	if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
		return json({ error: '無効なYouTube Video ID' }, { status: 400 });
	}

	const { success } = await ratelimit.limit(String(locals.profile.id));
	if (!success) {
		return json({ error: 'リクエストが多すぎます。5秒後に再試行してください' }, { status: 429 });
	}

	// YouTube Data API v3
	const ytUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;
	const ytRes = await fetch(ytUrl);
	if (!ytRes.ok) {
		const errBody = await ytRes.json().catch(() => ({}));
		console.error('YouTube API error:', ytRes.status, JSON.stringify(errBody));
		return json({ error: `YouTube APIエラー (${ytRes.status}): ${errBody?.error?.message ?? '不明'}` }, { status: 502 });
	}

	const ytData = await ytRes.json();
	const item = ytData.items?.[0];
	if (!item) {
		return json({ error: '動画が見つかりません' }, { status: 404 });
	}

	const snippetForPrompt = {
		channelTitle: item.snippet.channelTitle ?? '',
		description: (item.snippet.description ?? '').slice(0, 800),
		title: item.snippet.title ?? '',
		tags: item.snippet.tags ?? []
	};

	// Gemini で artist/source/tags を推定（ytyping と同じ generateText 方式）
	try {
		const google = createGoogleGenerativeAI({ apiKey: GOOGLE_API_KEY });
		const { text } = await generateText({
			model: google('gemini-flash-lite-latest'),
			providerOptions: {
				thinkingConfig: { thinkingLevel: 'low' }
			},
			prompt: `YouTube Data API snippet 由来のJSON(下記)のみを根拠に、譜面作成用情報を抽出する。

出力はJSON文字列のみ(説明/Markdown/コードフェンス/改行は不可)。キーは固定:
{"title":string,"artistName":string,"source":string,"otherTags":string[],"originalTitle":string,"isOfficialVideo":boolean,"isCover":boolean,"isMAD":boolean,"songLanguage":string}

規則:
- title/artistName/source抽出優先: (1)「曲名 - アーティスト」「アーティスト - 曲名」等を分解 (2) 区切り文字(例:" - ","｜","|","／","/",":","：")で曲名らしい塊を選ぶ。
- titleは譜面表示用の曲名。入力からアレンジ/版情報(Nightcore/Remix/Arrange/Ver./Short等)が明確に取れる場合のみ、titleに " - " 区切りで付与してよい(捏造禁止)。
- originalTitleは曲そのもののタイトルのみ。titleや入力文字列から、アレンジ/版情報・装飾語・括弧内の補足(MV/歌詞/cover/歌ってみた/弾いてみた/踊ってみた/feat./remix/short ver等)を除いた「素の曲名」を入れる。素の曲名が取れない場合はtitleをそのまま入れる(空文字にしない)。
- artistNameはカバー曲の場合はカバーしたアーティストを埋める。
- より正式名称らしい表記を推測(より正式なtitle/artistName/sourceを推論できる場合は翻訳可能)
- 入力内に候補がある限り空文字は避け、入力内の語句の切り出し/正規化の範囲で最も可能性が高いものを埋める。
- 候補が皆無のキーのみ: title/artistName/sourceは""、otherTagsは[]。
- sourceは作品タイトル(アニメ/ドラマ/映画等)が明確に特定できた場合のみ。括弧や装飾は除いて作品名だけ。
- otherTagsは入力内の固有名詞を短い単語で重複なく最大10件。title/artistName/sourceに既に含まれる語句はotherTagsに入れない（例: artistNameが「葛葉」なら「葛葉」はotherTagsに含めない）。
- isOfficialVideo: アーティスト本人または所属レーベル・公式チャンネルの投稿ならtrue。無断転載・ファンアップロード・非公式ならfalse。
- isCover: 原曲の作者とは別のアーティストが歌唱・演奏したカバー曲ならtrue（公式チャンネルのセルフカバーを含む）。原曲本人の歌唱かつ本人チャンネルの投稿ならfalse。MAD・音MAD・メドレー・リミックスはカバーではないのでfalse。
- isMAD: 音MAD・MAD動画・メドレー・リミックス・合作など、既存の音声・映像素材を組み合わせた二次創作動画ならtrue。通常のカバー曲・原曲・公式動画はfalse。
- songLanguage: **この動画で実際に歌唱されている言語**を title/description/tags から推定する（元の曲の言語ではなく、この動画のパフォーマンスの言語）。値は以下の4択のみ: "ja"(日本語のみ)、"en"(英語のみ、または英語が主体。English coverのように日本語曲を全編英語で歌っている場合も"en")、"en-ja"(英語と日本語が混在し英語の割合が有意にある場合のみ。サビの一部など数語だけ英語が含まれる程度ならば"ja"とする)、"other"(その他/不明)。

入力JSON:
${JSON.stringify(snippetForPrompt)}

出力JSON:`
		});

		const parsed = JSON.parse(text.trim()) as {
			title: string;
			artistName: string;
			source: string;
			otherTags: string[];
			originalTitle: string;
			isOfficialVideo: boolean;
			isCover: boolean;
			isMAD: boolean;
			songLanguage: string;
		};

		return json({
			title: parsed.title ?? '',
			artist: parsed.artistName ?? '',
			source: parsed.source ?? '',
			suggestedTags: parsed.otherTags ?? [],
			isOfficialVideo: parsed.isOfficialVideo ?? false,
			isCover: parsed.isCover ?? false,
			isMAD: parsed.isMAD ?? false,
			songLanguage: parsed.songLanguage ?? 'other'
		});
	} catch (err) {
		console.error('Gemini error:', err);
		return json({ title: snippetForPrompt.title, artist: snippetForPrompt.channelTitle, source: '', suggestedTags: [], isOfficialVideo: false, isCover: false, isMAD: false, songLanguage: 'other' });
	}
};
