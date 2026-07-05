// master_repl 投入前のパイプ分け精査ロジック（投入スクリプト共通）。
// reading に | がある行は、パイプ各パートのカバレッジ合計（+N/+* 補正込み）が
// key の文字数と一致しているべき。一致しない行は「パイプ分けミス」とみなす。
import { countPipeCoverage } from '../src/routes/edit/[[id]]/_lib/repl/coverage';

export type ReplRow = { key: string; reading: string };
export type PipeMismatch = ReplRow & { coverage: number; keyLen: number };

/** パイプ分けが key 文字数と整合しない行を返す（+* 可変は検査対象外）。 */
export function findPipeMismatches(rows: ReplRow[]): PipeMismatch[] {
	const bad: PipeMismatch[] = [];
	for (const r of rows) {
		if (!r.reading.includes('|')) continue;
		const coverage = countPipeCoverage(r.reading);
		if (coverage === -1) continue; // +* は可変なので検査不可
		const keyLen = [...r.key].length;
		if (coverage !== keyLen) bad.push({ ...r, coverage, keyLen });
	}
	return bad;
}

/**
 * 不整合があればレポートを出して process.exit(1) で投入を中止する。
 * @param label 検査対象の説明（ログ用）
 */
export function assertPipesValid(rows: ReplRow[], label = '投入データ'): void {
	const bad = findPipeMismatches(rows);
	if (bad.length === 0) {
		console.log(`パイプ精査 OK: ${label} に不整合なし`);
		return;
	}
	console.error(`パイプ分け不整合: ${bad.length} 件 — 投入を中止します`);
	for (const b of bad.slice(0, 30)) {
		console.error(`  ${b.key}(${b.keyLen}字),${b.reading}  -> coverage=${b.coverage}`);
	}
	if (bad.length > 30) console.error(`  ...他 ${bad.length - 30} 件`);
	process.exit(1);
}
