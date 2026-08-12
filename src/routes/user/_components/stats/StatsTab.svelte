<script lang="ts">
	import type { PageData } from '../../$types';
	import { chartThumbnailUrl, chartGradient } from '$lib/chart-thumbnail';

	let { data }: { data: PageData } = $props();

	const chartStats = $derived(data.stats.find((s: any) => s.source === 'chart'));
	const localStats = $derived(data.stats.find((s: any) => s.source === 'local'));
	const hasStats = $derived(data.stats.length > 0 || data.chartBreakdown.length > 0);

	function fmtNum(n: number | string | null | undefined): string {
		return Number(n ?? 0).toLocaleString();
	}
	function fmtDuration(ms: number | string | null | undefined): string {
		const total = Math.floor(Number(ms ?? 0) / 1000);
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		if (h > 0) return `${h}時間${m}分`;
		if (m > 0) return `${m}分${s}秒`;
		return `${s}秒`;
	}

	// 譜面別テーブル: ヘッダークリックでその列の降順に並び替える。
	type SortKey = 'title' | 'start_count' | 'retry_count' | 'finish_count' | 'keystrokes' | 'play_ms';
	const breakdownCols: { key: SortKey; label: string; left?: boolean }[] = [
		{ key: 'title', label: '譜面', left: true },
		{ key: 'start_count', label: 'スタート' },
		{ key: 'retry_count', label: 'リトライ' },
		{ key: 'finish_count', label: '完走' },
		{ key: 'keystrokes', label: '打鍵' },
		{ key: 'play_ms', label: 'プレイ時間' }
	];
	let sortKey = $state<SortKey>('start_count');
	let sortDir = $state<'asc' | 'desc'>('desc');

	// 同じ列をクリックで昇順/降順をトグル、別の列なら降順から開始。
	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'desc' ? 'asc' : 'desc';
		} else {
			sortKey = key;
			sortDir = 'desc';
		}
	}

	const sortedBreakdown = $derived(
		[...data.chartBreakdown].sort((a: any, b: any) => {
			const cmp =
				sortKey === 'title'
					? String(a.title ?? '').localeCompare(String(b.title ?? ''), 'ja')
					: Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0);
			return sortDir === 'desc' ? -cmp : cmp;
		})
	);
</script>

{#if !hasStats}
	<p class="stats-empty">まだプレイ記録がありません。譜面をプレイすると記録されます。</p>
{:else}
	<div class="stat-groups">
		{#each [{ label: '公開譜面', s: chartStats, isChart: true }, { label: 'ローカル譜面', s: localStats, isChart: false }] as g (g.label)}
			<div class="stat-group">
				<h2>{g.label}</h2>
				{#if g.s}
					<div class="stat-grid">
						<div class="stat stat-wide">
							<div class="split-item"><span class="lbl">スタート</span><span class="num">{fmtNum(g.s.start_count)}</span></div>
							<div class="split-item"><span class="lbl">リトライ</span><span class="num">{fmtNum(g.s.retry_count)}</span></div>
							<div class="split-item"><span class="lbl">完走</span><span class="num">{fmtNum(g.s.finish_count)}</span></div>
						</div>
						<div class="stat"><span class="lbl">総打鍵</span><span class="num">{fmtNum(g.s.keystrokes)}</span></div>
						<div class="stat"><span class="lbl">プレイ時間</span><span class="num">{fmtDuration(g.s.play_ms)}</span></div>
						{#if g.isChart}
							<div class="stat"><span class="lbl">譜面数</span><span class="num">{fmtNum(g.s.charts_played)}</span></div>
						{/if}
					</div>
				{:else}
					<p class="stats-empty small">記録なし</p>
				{/if}
			</div>
		{/each}
	</div>

	{#if data.chartBreakdown.length > 0}
		<h2 class="breakdown-title">譜面別</h2>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						{#each breakdownCols as col (col.key)}
							<th class:left={col.left} class:active={sortKey === col.key}>
								<button
									type="button"
									class="sort-btn"
									class:active={sortKey === col.key}
									onclick={() => toggleSort(col.key)}
								>
									<span class="sort-label">{col.label}</span
									><span class="sort-ind" aria-hidden="true">
										{#if sortKey === col.key}
											<!-- ▲▼ を縦に並べ、現在の向きだけ明るくする -->
											<span class="sort-arrow" class:on={sortDir === 'asc'}>▲</span>
											<span class="sort-arrow" class:on={sortDir === 'desc'}>▼</span>
										{/if}
									</span>
								</button>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each sortedBreakdown as c (c.chart_id)}
						<tr>
							<td class="title-cell">
								<a class="chart-link" href={`/chart/${c.chart_id}`}>
									{#if c.youtube_video_id}
										<img
											class="thumb"
											src={chartThumbnailUrl(c.youtube_video_id)}
											alt=""
											loading="lazy"
											decoding="async"
											width="64"
											height="36"
										/>
									{:else}
										<span class="thumb thumb-fallback" style:background-image={chartGradient(c.chart_id)}></span>
									{/if}
									<span class="title-text">
										<span class="title-main">{c.title}</span>
										{#if c.artist}<span class="artist">{c.artist}</span>{/if}
									</span>
								</a>
							</td>
							<td>{fmtNum(c.start_count)}</td>
							<td>{fmtNum(c.retry_count)}</td>
							<td>{fmtNum(c.finish_count)}</td>
							<td>{fmtNum(c.keystrokes)}</td>
							<td>{fmtDuration(c.play_ms)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}

<style>
	h1 {
		color: #ddd;
		margin: 0 0 32px;
		font-size: 1.5rem;
	}

	.stats-empty {
		color: #aaa;
		font-size: 0.9rem;
		margin: 0;
	}
	.stats-empty.small {
		font-size: 0.82rem;
	}

	.stat-groups {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
		margin-bottom: 28px;
	}
	@media (max-width: 560px) {
		.stat-groups {
			grid-template-columns: 1fr;
		}
	}

	.stat-group h2 {
		color: #e6e6e6;
		font-size: 0.95rem;
		margin: 0 0 12px;
	}

	.stat-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.stat {
		display: flex;
		flex-direction: column;
		background: #2a2a2a;
		border: 1px solid #3a3a3a;
		border-radius: 8px;
		padding: 10px 12px;
	}
	/* スタート/リトライ/完走 をまとめたブロックは1行いっぱいに広げ、
	   中で3要素を等間隔（等幅）に並べて仕切り線で区切る */
	.stat-wide {
		grid-column: 1 / -1;
		flex-direction: row;
		padding: 10px 0;
	}
	.split-item {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 0 14px;
	}
	.split-item + .split-item {
		border-left: 1px solid #3a3a3a;
	}
	.stat .lbl {
		color: #c2c2c2;
		font-size: 0.74rem;
		margin-bottom: 4px;
	}
	.stat .num {
		color: #f2f2f2;
		font-size: 1.15rem;
		font-weight: 600;
		line-height: 1.3;
	}

	.breakdown-title {
		color: #e6e6e6;
		font-size: 1rem;
		margin: 8px 0 12px;
	}

	.table-wrap {
		overflow-x: auto;
		border: 1px solid #3a3a3a;
		border-radius: 8px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	thead th {
		background: #2c2c2c;
		border-bottom: 2px solid #454545;
		padding: 0;
		text-align: right;
		white-space: nowrap;
	}
	thead th.left {
		text-align: left;
	}
	.sort-btn {
		width: 100%;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 500;
		color: #b5b5b5;
		background: none;
		border: none;
		padding: 10px 12px;
		cursor: pointer;
		text-align: inherit;
		white-space: nowrap;
		transition: background 0.12s, color 0.12s;
	}
	.sort-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #fff;
	}
	.sort-btn.active {
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
	}
	/* 並び替え方向の矢印。▲▼ を縦に並べ、常に幅を確保して列幅が動かないようにする */
	.sort-ind {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 1em;
		margin-left: 4px;
		vertical-align: middle;
		font-size: 0.6rem;
		line-height: 1;
	}
	.sort-arrow {
		/* 非選択の向きは薄く残して、クリックで切り替わることを示す */
		color: #777;
	}
	.sort-arrow.on {
		color: #fff;
	}
	/* 並び替え中の列ヘッダーは下線を明るくして「この列」と分かるようにする */
	thead th.active {
		border-bottom-color: #cfcfcf;
	}

	tbody td {
		padding: 9px 12px;
		text-align: right;
		white-space: nowrap;
		border-bottom: 1px solid #333;
		color: #e0e0e0;
	}
	tbody tr:last-child td {
		border-bottom: none;
	}
	tbody tr:hover td {
		background: rgba(255, 255, 255, 0.035);
	}
	td.title-cell {
		text-align: left;
	}

	.chart-link {
		display: flex;
		align-items: center;
		gap: 10px;
		color: #eee;
		text-decoration: none;
	}
	.thumb {
		width: 64px;
		height: 36px;
		border-radius: 4px;
		object-fit: cover;
		flex-shrink: 0;
		background: #1a1a1a;
	}
	.thumb-fallback {
		display: inline-block;
		background-size: cover;
		background-position: center;
	}
	.title-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.title-main {
		color: #eee;
	}
	.chart-link:hover .title-main {
		color: #fff;
		text-decoration: underline;
	}
	.title-cell .artist {
		color: #9a9a9a;
		font-size: 0.72rem;
	}
</style>
