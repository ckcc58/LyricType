import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, request }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) {
		return json({ error: '無効なID' }, { status: 400 });
	}

	// バージョン判定用に updated_at / created_at だけ先に取得（軽い）
	const { data: meta, error: metaErr } = await locals.supabase
		.from('charts')
		.select('updated_at, created_at')
		.eq('id', id)
		.eq('status', 'active')
		.single();

	if (metaErr || !meta) {
		return json({ error: '譜面が見つかりません' }, { status: 404 });
	}

	const version = meta.updated_at ?? meta.created_at;
	const etag = `"${version}"`;

	// ブラウザのキャッシュ済みバージョンと一致 → 中身ゼロで返す
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, {
			status: 304,
			headers: {
				etag,
				'cache-control': 'public, max-age=0, must-revalidate'
			}
		});
	}

	// 譜面データ取得
	const { data, error: dataErr } = await locals.supabase
		.from('charts')
		.select('chart_data')
		.eq('id', id)
		.eq('status', 'active')
		.single();

	if (dataErr || !data) {
		return json({ error: '譜面が見つかりません' }, { status: 404 });
	}

	return new Response(JSON.stringify({ chart_data: data.chart_data, version }), {
		headers: {
			'Content-Type': 'application/json',
			etag,
			'cache-control': 'public, max-age=0, must-revalidate'
		}
	});
};
