// static/master-repl.txt にあって本番 master_repl に無いエントリを書き出す（読み取りのみ）。
// レビュー用。出力先は引数 or 既定の scratchpad。
// 実行例: node --env-file=.env --import tsx scripts/export-not-in-prod.ts <出力パス>
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { findPipeMismatches } from './master-repl-validate';

const url = process.env.PUBLIC_SUPABASE_URL;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
	console.error('PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY が未設定です');
	process.exit(1);
}
const outPath = process.argv[2] || 'not-in-prod.txt';
const supabase = createClient(url, anon);

const rows = readFileSync('static/master-repl.txt', 'utf-8')
	.trim()
	.split('\n')
	.map((l) => l.trim())
	.filter(Boolean)
	.map((line) => {
		const idx = line.indexOf(',');
		return idx < 0 ? null : { key: line.slice(0, idx), reading: line.slice(idx + 1) };
	})
	.filter((r): r is { key: string; reading: string } => r !== null);
const deduped = Array.from(new Map(rows.map((r) => [r.key, r])).values());

const PAGE = 1000;
const existing = new Set<string>();
for (let offset = 0; ; offset += PAGE) {
	const { data, error } = await supabase
		.from('master_repl')
		.select('key')
		.order('key', { ascending: true })
		.range(offset, offset + PAGE - 1);
	if (error) {
		console.error('既存キー取得エラー:', error);
		process.exit(1);
	}
	if (!data || data.length === 0) break;
	for (const r of data) existing.add(r.key);
	if (data.length < PAGE) break;
}

const notInProd = deduped.filter((r) => !existing.has(r.key));
const badKeys = new Set(findPipeMismatches(notInProd).map((m) => m.key));

const lines = notInProd.map((r) => `${badKeys.has(r.key) ? '⚠ ' : '  '}${r.key},${r.reading}`);
const header = [
	`# static/master-repl.txt にあって本番に無いエントリ: ${notInProd.length} 件`,
	`# うちパイプ壊れ(⚠): ${badKeys.size} 件`,
	'#'
];
writeFileSync(outPath, header.concat(lines).join('\n') + '\n', 'utf-8');
console.log(`書き出し: ${outPath} (${notInProd.length} 件, パイプ壊れ ${badKeys.size} 件)`);
