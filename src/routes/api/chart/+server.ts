import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { chartSubmitSchema } from '$lib/schemas/chart';
import { parseLyric } from '$lib/parseLyric/parse-chart';
import { serializeChart } from '$lib/chart-serialization';
import { calcDifficulty } from '$lib/difficulty';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.profile) {
		return json({ error: 'ログインが必要です' }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: '無効なリクエスト' }, { status: 400 });
	}

	const parsed = chartSubmitSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}
	const data = parsed.data;

	const lyric = parseLyric(data.lrc_raw, data.repl_raw);

	const noteCount = lyric.reduce(
		(acc, entry) => acc + entry.segments.reduce((s, seg) => s + seg.normalizedText.length, 0),
		0
	);
	if (noteCount === 0) {
		return json({ error: '譜面にノートがありません' }, { status: 400 });
	}

	const chartData = serializeChart(lyric);
	const phraseCount = lyric.length;
	// プレビュー開始位置: 明示指定が無ければ歌詞の最初のタイムタグ時刻
	const previewTime =
		data.preview_time !== undefined
			? data.preview_time
			: lyric.length > 0
				? lyric[0].time
				: null;

	// 実曲長 (クライアントのプレイヤー由来) を優先。無ければ歌詞末尾から近似
	const durationSeconds = data.duration_seconds
		? Math.ceil(data.duration_seconds)
		: lyric.length > 0
			? Math.ceil(lyric[lyric.length - 1].endTime - lyric[0].time)
			: 0;
	const {
		avgCpm,
		medianCpm,
		peakCpm,
		peakStartLineNo,
		peakStartLineText,
		peakEndLineNo,
		peakEndLineText,
		charTypes
	} = calcDifficulty(chartData.lyric, data.duration_seconds);

	const { data: inserted, error: dbError } = await locals.supabase
		.from('charts')
		.insert({
			uploader_id: locals.profile!.id,
			title: data.title,
			artist: data.artist || null,
			description: data.description || null,
			lrc_raw: data.lrc_raw,
			repl_raw: data.repl_raw,
			chart_data: chartData,
			youtube_video_id: data.youtube_video_id || null,
			media_source: data.youtube_video_id ? 'youtube' : null,
			note_count: noteCount,
			phrase_count: phraseCount,
			duration_seconds: durationSeconds,
			preview_time: previewTime,
			source: data.source || '',
			tags: data.tags ?? [],
			avg_cpm: avgCpm,
			median_cpm: medianCpm,
			peak_cpm: peakCpm,
			peak_start_line_no: peakStartLineNo,
			peak_start_line_text: peakStartLineText,
			peak_end_line_no: peakEndLineNo,
			peak_end_line_text: peakEndLineText,
			char_types: charTypes
		})
		.select('id')
		.single();

	if (dbError) {
		console.error('Chart insert error:', dbError);
		return json({ error: '保存に失敗しました' }, { status: 500 });
	}

	return json({ id: inserted.id }, { status: 201 });
};
