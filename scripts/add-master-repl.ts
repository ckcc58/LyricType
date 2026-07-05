// static/master-repl.txt のエントリを対象DBへ「追記専用」で投入する。
// 既存キーは上書きせず（INSERT ... ON CONFLICT DO NOTHING）、新規キーだけ追加する。
// そのため古い/部分的な master-repl.txt を流しても既存データを壊さない。
//
// 本番へ追加する例:
//   node --env-file=.env --import tsx scripts/add-master-repl.ts
// ローカルへ追加する例:
//   node --env-file=.env.local --import tsx scripts/add-master-repl.ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { assertPipesValid, findPipeMismatches } from './master-repl-validate';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
	console.error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です');
	console.error('実行例: node --env-file=.env --import tsx scripts/add-master-repl.ts');
	process.exit(1);
}

const isProd = !url.includes('127.0.0.1') && !url.includes('localhost');
console.log(`投入先: ${url} ${isProd ? '(本番)' : '(ローカル)'}`);

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

console.log(`ファイル総エントリ数: ${rows.length}`);

// 同一キーの重複を除去（後勝ち）
const deduped = Array.from(new Map(rows.map((r) => [r.key, r])).values());
if (deduped.length !== rows.length) {
	console.log(`重複除去: ${rows.length} -> ${deduped.length} 件`);
}

const dryRun = process.argv.includes('--dry-run');

// --dry-run: 書き込まず、追加されるであろう新規キーと精査結果を表示するだけ
if (dryRun) {
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
	const newRows = deduped.filter((r) => !existing.has(r.key));
	const mismatches = findPipeMismatches(deduped);
	console.log(`\n[DRY RUN] 既存 ${existing.size} 件 / ファイル ${deduped.length} 件`);
	console.log(`[DRY RUN] 追加されるであろう新規キー: ${newRows.length} 件`);
	for (const r of newRows.slice(0, 100)) console.log(`  + ${r.key},${r.reading}`);
	if (newRows.length > 100) console.log(`  ...他 ${newRows.length - 100} 件`);
	if (mismatches.length > 0) {
		console.log(`\n[DRY RUN] ⚠ パイプ不整合 ${mismatches.length} 件（本番実行時はここで中止されます）:`);
		for (const m of mismatches) console.log(`  ${m.key}(${m.keyLen}字),${m.reading} -> coverage=${m.coverage}`);
	}
	console.log('\n[DRY RUN] 書き込みは行っていません');
	process.exit(0);
}

// パイプ分け精査: 不整合があれば投入を中止
assertPipesValid(deduped, 'static/master-repl.txt');

// 追記専用 upsert: ignoreDuplicates で既存キーは無視し、新規だけ INSERT。
// .select() の返却は実際に挿入された行のみなので、それを数えて報告する。
const CHUNK = 1000;
const insertedKeys: string[] = [];
for (let i = 0; i < deduped.length; i += CHUNK) {
	const chunk = deduped.slice(i, i + CHUNK);
	const { data, error } = await supabase
		.from('master_repl')
		.upsert(chunk, { onConflict: 'key', ignoreDuplicates: true })
		.select('key');
	if (error) {
		console.error(`Batch ${i} 失敗:`, error);
		process.exit(1);
	}
	for (const r of data ?? []) insertedKeys.push(r.key);
	console.log(`処理 ${Math.min(i + CHUNK, deduped.length)} / ${deduped.length} 件`);
}

console.log(`\n新規追加: ${insertedKeys.length} 件（既存キーはスキップ）`);
for (const k of insertedKeys.slice(0, 50)) console.log(`  + ${k}`);
if (insertedKeys.length > 50) console.log(`  ...他 ${insertedKeys.length - 50} 件`);
console.log('完了');
