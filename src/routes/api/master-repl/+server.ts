import type { RequestHandler } from './$types';

let cache: { etag: string; body: string } | null = null;

export const GET: RequestHandler = async ({ locals, request }) => {
	const { data: latest, error: latestErr } = await locals.supabase
		.from('master_repl')
		.select('updated_at')
		.order('updated_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (latestErr) {
		console.error('[/api/master-repl] Supabase エラー:', latestErr);
		return new Response('', { status: 500 });
	}

	const etag = latest ? `"${latest.updated_at}"` : '"empty"';

	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, {
			status: 304,
			headers: { etag, 'cache-control': 'private, no-cache' }
		});
	}

	if (cache && cache.etag === etag) {
		return new Response(cache.body, {
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
				etag,
				'cache-control': 'private, no-cache'
			}
		});
	}

	const PAGE = 1000;
	const all: { key: string; reading: string }[] = [];
	for (let offset = 0; ; offset += PAGE) {
		const { data, error } = await locals.supabase
			.from('master_repl')
			.select('key, reading')
			.order('key', { ascending: true })
			.range(offset, offset + PAGE - 1);
		if (error) {
			console.error('[/api/master-repl] Supabase 全件エラー:', error);
			return new Response('', { status: 500 });
		}
		if (!data || data.length === 0) break;
		all.push(...data);
		if (data.length < PAGE) break;
	}

	const body = all.map((r) => `${r.key},${r.reading}`).join('\n');
	cache = { etag, body };

	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			etag,
			'cache-control': 'private, no-cache'
		}
	});
};
