import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { chartSubmitSchema } from '$lib/schemas/chart';
import { parseLyric } from '$lib/parseLyric/parse-chart';
import { serializeChart } from '$lib/chart-serialization';
import { calcDifficulty } from '$lib/difficulty';

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) {
		return json({ error: '無効なID' }, { status: 400 });
	}

	if (!locals.user || !locals.profile) {
		return json({ error: 'ログインが必要です' }, { status: 401 });
	}

	const { data: chart, error: fetchError } = await locals.supabase
		.from('charts')
		.select('uploader_id')
		.eq('id', id)
		.single();

	if (fetchError || !chart) {
		return json({ error: '譜面が見つかりません' }, { status: 404 });
	}

	const isAdmin = locals.profile.role === 'admin';
	if (!isAdmin && chart.uploader_id !== locals.profile.id) {
		return json({ error: '投稿者のみ更新可能です' }, { status: 403 });
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

	let query = locals.supabase
		.from('charts')
		.update({
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
			char_types: charTypes,
			updated_at: new Date().toISOString()
		})
		.eq('id', id);

	if (!isAdmin) {
		query = query.eq('uploader_id', locals.profile.id);
	}

	const { error: dbError } = await query;

	if (dbError) {
		console.error('Chart update error:', dbError);
		return json({ error: '更新に失敗しました' }, { status: 500 });
	}

	return json({ ok: true });
};
