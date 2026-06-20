import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, request, url }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) {
		return json({ error: '無効なID' }, { status: 400 });
	}

	// 譜面データ + バージョンを1クエリで取得
	const { data, error: dataErr } = await locals.supabase
		.from('charts')
		.select('chart_data, updated_at, created_at')
		.eq('id', id)
		.eq('status', 'active')
		.single();

	if (dataErr || !data) {
		return json({ error: '譜面が見つかりません' }, { status: 404 });
	}

	const version = data.updated_at ?? data.created_at;
	const etag = `"${version}"`;

	// クライアントは ?v={updated_at} 付きでアクセスする。
	// バージョンが一致すれば内容は不変なので、ブラウザ・CDN 双方で長期キャッシュできる
	// (更新されると URL 自体が変わるので stale を配ることはない)。
	const requestedVersion = url.searchParams.get('v');
	const cacheControl =
		requestedVersion === version
			? 'public, max-age=31536000, s-maxage=31536000, immutable'
			: 'public, max-age=0, must-revalidate';

	// ブラウザのキャッシュ済みバージョンと一致 → 中身ゼロで返す
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, {
			status: 304,
			headers: { etag, 'cache-control': cacheControl }
		});
	}

	return new Response(JSON.stringify({ chart_data: data.chart_data, version }), {
		headers: {
			'Content-Type': 'application/json',
			etag,
			'cache-control': cacheControl
		}
	});
};
