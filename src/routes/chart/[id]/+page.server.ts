import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) {
		error(404, '譜面が見つかりません');
	}

	const { data: chart, error: dbError } = await locals.supabase
		.from('charts')
		.select(
			'id, title, artist, source, tags, description, difficulty, avg_cpm, peak_cpm, youtube_video_id, media_source, note_count, phrase_count, duration_seconds, play_count, score_count, created_at, updated_at, uploader_id, users(name, handle)'
		)
		.eq('id', id)
		.eq('status', 'active')
		.single();

	if (dbError || !chart) {
		error(404, '譜面が見つかりません');
	}

	// ランキング・リプレイデータはクライアント側で API 経由で取得（SSR HTML を軽量化するため）

	return {
		chart,
		currentUserId: locals.profile?.id ?? null
	};
};
