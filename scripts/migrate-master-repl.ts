import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
	console.error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です');
	console.error('実行例: node --env-file=.env --import tsx scripts/migrate-master-repl.ts');
	process.exit(1);
}

const supabase = createClient(url, key);

const text = readFileSync('static/master-repl.txt', 'utf-8');
const rows = text
	.trim()
	.split('\n')
	.map((line) => line.trim())
	.filter((line) => line)
	.map((line) => {
		const idx = line.indexOf(',');
		if (idx < 0) return null;
		const key = line.slice(0, idx);
		const reading = line.slice(idx + 1);
		return { key, reading, status: 'verified' };
	})
	.filter((r): r is { key: string; reading: string; status: string } => r !== null);

console.log(`総エントリ数: ${rows.length}`);

// 重複キーを検出
const seen = new Map<string, string>();
const dups: string[] = [];
for (const r of rows) {
	if (seen.has(r.key) && seen.get(r.key) !== r.reading) {
		dups.push(`${r.key}: ${seen.get(r.key)} vs ${r.reading}`);
	}
	seen.set(r.key, r.reading);
}
if (dups.length > 0) {
	console.warn(`重複キー (後勝ち): ${dups.length}件`);
	dups.slice(0, 10).forEach((d) => console.warn(`  ${d}`));
	if (dups.length > 10) console.warn(`  ...他 ${dups.length - 10}件`);
}

const CHUNK = 1000;
for (let i = 0; i < rows.length; i += CHUNK) {
	const chunk = rows.slice(i, i + CHUNK);
	const { error } = await supabase.from('master_repl').upsert(chunk, { onConflict: 'key' });
	if (error) {
		console.error(`Batch ${i} 失敗:`, error);
		process.exit(1);
	}
	console.log(`Upserted ${i + chunk.length} / ${rows.length}`);
}
console.log('完了');
