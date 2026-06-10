import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.supabase) {
		return { charts: [] };
	}

	const { data: charts } = await locals.supabase
		.from('charts')
		.select(
			'id, title, artist, source, tags, avg_cpm, median_cpm, peak_cpm, peak_start_line_no, peak_start_line_text, peak_end_line_no, peak_end_line_text, char_types, youtube_video_id, note_count, phrase_count, play_count, score_count, duration_seconds, created_at, uploader_id, users(name)'
		)
		.eq('status', 'active')
		.order('created_at', { ascending: false })
		.range(0, 19);

	return { charts: charts ?? [] };
};
