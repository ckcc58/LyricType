import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const PAGE_SIZE = 20;

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.supabase) {
		return json({ charts: [], nextPage: null });
	}

	const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0'));
	const from = page * PAGE_SIZE;
	const to = from + PAGE_SIZE - 1;

	const { data: charts, error } = await locals.supabase
		.from('charts')
		.select(
			'id, title, artist, source, tags, avg_cpm, median_cpm, peak_cpm, peak_start_line_no, peak_start_line_text, peak_end_line_no, peak_end_line_text, char_types, youtube_video_id, note_count, phrase_count, play_count, score_count, duration_seconds, created_at, uploader_id, users(name)'
		)
		.eq('status', 'active')
		.order('created_at', { ascending: false })
		.range(from, to);

	if (error) {
		return json({ error: 'データ取得に失敗しました' }, { status: 500 });
	}

	const list = charts ?? [];
	return json({
		charts: list,
		nextPage: list.length === PAGE_SIZE ? page + 1 : null
	});
};
