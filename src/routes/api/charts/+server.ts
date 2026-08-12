import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const PAGE_SIZE = 20;

// ETag 用の軽量ハッシュ (djb2)
function djb2Hex(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
	return (h >>> 0).toString(16);
}

// ETag + max-age=0 の条件付き再検証方式。
// ページ遷移のたびにブラウザが If-None-Match で問い合わせ、内容が変わっていなければ
// 304 (本文なし)、変わっていれば即座に新しい一覧が返る。s-maxage / SWR のように
// 古い一覧を配り続けない (譜面更新後にハードリロードしないと反映されない問題の対策)。
const CACHE_CONTROL = 'public, max-age=0, must-revalidate';

export const GET: RequestHandler = async ({ url, locals, request }) => {
	if (!locals.supabase) {
		return json({ charts: [], nextPage: null });
	}

	const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0'));
	const from = page * PAGE_SIZE;
	const to = from + PAGE_SIZE - 1;

	const { data: charts, error } = await locals.supabase
		.from('charts')
		.select(
			'id, title, artist, source, tags, avg_cpm, median_cpm, peak_cpm, peak_start_line_no, peak_start_line_text, peak_end_line_no, peak_end_line_text, char_types, youtube_video_id, note_count, phrase_count, play_count, score_count, duration_seconds, preview_time, created_at, uploader_id, users!charts_uploader_id_users_id_fkey(name)'
		)
		.eq('status', 'active')
		.order('created_at', { ascending: false })
		.range(from, to);

	if (error) {
		return json({ error: 'データ取得に失敗しました' }, { status: 500 });
	}

	const list = charts ?? [];
	const body = JSON.stringify({
		charts: list,
		nextPage: list.length === PAGE_SIZE ? page + 1 : null
	});
	const etag = `"${djb2Hex(body)}"`;

	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, {
			status: 304,
			headers: { etag, 'cache-control': CACHE_CONTROL }
		});
	}

	return new Response(body, {
		headers: {
			'content-type': 'application/json',
			etag,
			'cache-control': CACHE_CONTROL
		}
	});
};
