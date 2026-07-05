// 本番 Supabase の master_repl をローカル Supabase へ同期する。
// 本番からは anon キーで SELECT（RLS で anon 読み取り許可済み）、
// ローカルへは service_role キーで upsert する。本番へは書き込まない。
//
// 実行例: node --import tsx scripts/sync-master-repl-from-prod.ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { assertPipesValid } from './master-repl-validate';

function parseEnv(path: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const raw of readFileSync(path, 'utf-8').split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const idx = line.indexOf('=');
		if (idx < 0) continue;
		out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\/+$/, '');
	}
	return out;
}

const prod = parseEnv('.env');
const local = parseEnv('.env.local');

const prodUrl = prod.PUBLIC_SUPABASE_URL;
const prodAnon = prod.PUBLIC_SUPABASE_ANON_KEY;
const localUrl = local.PUBLIC_SUPABASE_URL;
const localKey = local.SUPABASE_SERVICE_ROLE_KEY;

if (!prodUrl || !prodAnon) {
	console.error('.env に PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY が必要です');
	process.exit(1);
}
if (!localUrl || !localKey) {
	console.error('.env.local に PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です');
	process.exit(1);
}
if (!localUrl.includes('127.0.0.1') && !localUrl.includes('localhost')) {
	console.error(`書き込み先がローカルではありません: ${localUrl} — 中断します`);
	process.exit(1);
}

console.log(`SRC  (本番/読み取り): ${prodUrl}`);
console.log(`DEST (ローカル/書込): ${localUrl}`);

const src = createClient(prodUrl, prodAnon);
const dest = createClient(localUrl, localKey);

// 本番から全件取得
const PAGE = 1000;
const rows: { key: string; reading: string }[] = [];
for (let offset = 0; ; offset += PAGE) {
	const { data, error } = await src
		.from('master_repl')
		.select('key, reading')
		.order('key', { ascending: true })
		.range(offset, offset + PAGE - 1);
	if (error) {
		console.error('本番取得エラー:', error);
		process.exit(1);
	}
	if (!data || data.length === 0) break;
	rows.push(...data);
	if (data.length < PAGE) break;
}
console.log(`本番から取得: ${rows.length} 件`);

// キーで一意化（後勝ち）してから upsert
const deduped = Array.from(
	new Map(rows.map((r) => [r.key, { key: r.key, reading: r.reading, status: 'verified' }])).values()
);
if (deduped.length !== rows.length) {
	console.log(`重複除去: ${rows.length} -> ${deduped.length} 件`);
}

// パイプ分け精査: 不整合があればここで投入を中止する
assertPipesValid(deduped, '本番 master_repl');

const CHUNK = 1000;
for (let i = 0; i < deduped.length; i += CHUNK) {
	const chunk = deduped.slice(i, i + CHUNK);
	const { error } = await dest.from('master_repl').upsert(chunk, { onConflict: 'key' });
	if (error) {
		console.error(`Batch ${i} 失敗:`, error);
		process.exit(1);
	}
	console.log(`Upserted ${i + chunk.length} / ${deduped.length}`);
}
console.log('完了');
