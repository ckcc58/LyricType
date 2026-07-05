// static/master-repl.txt のキーを本番と照合。完全一致だけでなく、
// 「本番に staticKey を前方一致で含むキー（送り仮名込み拡張形）」があるかも見る。
// 実行例: node --env-file=.env --import tsx scripts/analyze-not-in-prod.ts <出力パス>
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

const url = process.env.PUBLIC_SUPABASE_URL!;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY!;
const outPath = process.argv[2] || 'truly-absent.txt';
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
const prodKeys: string[] = [];
for (let offset = 0; ; offset += PAGE) {
	const { data, error } = await supabase
		.from('master_repl')
		.select('key')
		.order('key', { ascending: true })
		.range(offset, offset + PAGE - 1);
	if (error) {
		console.error(error);
		process.exit(1);
	}
	if (!data || data.length === 0) break;
	for (const r of data) prodKeys.push(r.key);
	if (data.length < PAGE) break;
}
const exact = new Set(prodKeys);
// 本番キーの全プレフィックス集合（staticKey が本番キーの前方部分なら拡張形あり）
const prefixSet = new Set<string>();
for (const k of prodKeys) {
	const chars = [...k];
	for (let i = 1; i <= chars.length; i++) prefixSet.add(chars.slice(0, i).join(''));
}

const exactHit: typeof deduped = [];
const extendedHit: { key: string; reading: string; prodForms: string[] }[] = [];
const trulyAbsent: typeof deduped = [];
for (const r of deduped) {
	if (exact.has(r.key)) {
		exactHit.push(r);
	} else if (prefixSet.has(r.key)) {
		const forms = prodKeys.filter((k) => k !== r.key && [...k].slice(0, [...r.key].length).join('') === r.key);
		extendedHit.push({ ...r, prodForms: forms });
	} else {
		trulyAbsent.push(r);
	}
}

console.log(`static 総数: ${deduped.length}`);
console.log(`本番に完全一致: ${exactHit.length}`);
console.log(`本番に送り仮名込み拡張形あり: ${extendedHit.length}`);
console.log(`本番に全く無い(真の欠落): ${trulyAbsent.length}`);

const out: string[] = [];
out.push(`# 真の欠落（完全一致も前方一致も無い）: ${trulyAbsent.length} 件`);
out.push('#');
for (const r of trulyAbsent) out.push(`${r.key},${r.reading}`);
out.push('');
out.push(`# 送り仮名込み拡張形が本番にあるもの: ${extendedHit.length} 件 (例: 先頭50)`);
out.push('#');
for (const e of extendedHit.slice(0, 50)) out.push(`${e.key},${e.reading}  => 本番: ${e.prodForms.slice(0, 4).join(' / ')}`);
writeFileSync(outPath, out.join('\n') + '\n', 'utf-8');
console.log(`書き出し: ${outPath}`);
