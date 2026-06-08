import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// サーバ時刻同期用エンドポイント。
// レスポンスの Date ヘッダ + body の server_time を使ってクライアント側で
// (serverTime - localTime) を計算し offset として保持する。
//
// 計算例 (クライアント):
//   const t0 = Date.now();
//   const res = await fetch('/api/ping');
//   const t1 = Date.now();
//   const { server_time } = await res.json();
//   const rtt = t1 - t0;
//   const offset = server_time - (t0 + rtt / 2);
//   // 以後 const serverNow = Date.now() + offset;
export const GET: RequestHandler = async () => {
	const now = Date.now();
	return json(
		{ server_time: now },
		{
			headers: {
				'Cache-Control': 'no-store, no-cache, must-revalidate',
				'Date': new Date(now).toUTCString(),
			},
		},
	);
};
