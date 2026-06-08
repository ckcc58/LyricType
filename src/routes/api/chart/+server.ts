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

	// レート制限: 1日10件
	const { count } = await locals.supabase
		.from('charts')
		.select('id', { count: 'exact', head: true })
		.eq('uploader_id', locals.profile!.id)
		.gte('created_at', new Date(Date.now() - 86400000).toISOString());

	if ((count ?? 0) >= 10) {
		return json({ error: '1日の投稿上限（10件）に達しました' }, { status: 429 });
	}

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
	const durationSeconds =
		lyric.length > 0 ? Math.ceil(lyric[lyric.length - 1].endTime - lyric[0].time) : 0;
	const {
		avgCpm,
		medianCpm,
		peakCpm,
		peakStartLineNo,
		peakStartLineText,
		peakEndLineNo,
		peakEndLineText,
		charTypes
	} = calcDifficulty(chartData.lyric);

	const { data: inserted, error: dbError } = await locals.supabase
		.from('charts')
		.insert({
			uploader_id: locals.profile!.id,
			title: data.title,
			artist: data.artist || null,
			difficulty: data.difficulty || null,
			description: data.description || null,
			lrc_raw: data.lrc_raw,
			repl_raw: data.repl_raw,
			chart_data: chartData,
			youtube_video_id: data.youtube_video_id || null,
			media_source: data.youtube_video_id ? 'youtube' : null,
			note_count: noteCount,
			phrase_count: phraseCount,
			duration_seconds: durationSeconds,
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
