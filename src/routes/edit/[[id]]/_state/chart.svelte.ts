// LRC + Repl 関連の中央ストア

class ChartState {
  // LRC
  lrcContent = $state("");
  lrcYtId = $state(""); // 既存LRCから読み取った@ytid

  // LRC 検索・置換 (リテラル検索 + 一部エスケープ \s \d \n \t をサポート)
  lrcFindText = $state("");
  lrcReplaceText = $state("");
  lrcFindCase = $state(false);
  lrcFindIdx = $state(0);

  // Repl 本体
  masterReplContent = $state("");
  isMasterLoaded = $state(false);
  chartReplContent = $state("");
  appliedChartReplContent = $state("");
  appliedMasterReplContent = $state("");

  // Repl 生成
  isGeneratingRepl = $state(false);
  isGeneratingReplLite = $state(false);
  validationMsg = $state("");
  replOptimizeInfo = $state("");

  // 最適化Diff表示
  showOptDiff = $state(false);
  lastMergedRepl = $state("");
  lastOptimizedRepl = $state("");

  // Pipe 編集
  ignorePipeSet = $state(new Set<string>());
  isPipeEditing = $state(false);
  peFocus = $state(0); // 読み文字間のフォーカス位置（0始まり）
  peDecisions = $state<("|" | "+" | null)[]>([]); // 各位置の決定
}

export const chart = new ChartState();
