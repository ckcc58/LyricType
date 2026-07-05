// 本番 master_repl のパイプ分けが key の文字数と整合しているか検査する（読み取りのみ）。
// 検証ロジックは投入スクリプトと共通の master-repl-validate を使う。
// 実行例: node --import tsx scripts/check-master-repl-pipes.ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { findPipeMismatches } from './master-repl-validate';

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

const env = parseEnv('.env');
const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY);

const PAGE = 1000;
const rows: { key: string; reading: string }[] = [];
for (let offset = 0; ; offset += PAGE) {
	const { data, error } = await supabase
		.from('master_repl')
		.select('key, reading')
		.order('key', { ascending: true })
		.range(offset, offset + PAGE - 1);
	if (error) {
		console.error('取得エラー:', error);
		process.exit(1);
	}
	if (!data || data.length === 0) break;
	rows.push(...data);
	if (data.length < PAGE) break;
}
console.log(`検査対象: ${rows.length} 件`);

const mismatches = findPipeMismatches(rows);
console.log(`不整合: ${mismatches.length} 件`);
for (const m of mismatches) {
	console.log(`  ${m.key}(${m.keyLen}字),${m.reading}  -> coverage=${m.coverage}`);
}
process.exit(mismatches.length > 0 ? 1 : 0);
