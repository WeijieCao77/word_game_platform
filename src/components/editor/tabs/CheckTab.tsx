"use client";

import { ValidationIssue } from "@/lib/schema";

// 校验页签：发布前的体检单——断头路、玩不到的结局、数值越界都列在这，
// 外加一键跑 200 局模拟看结局分布。有 error 时发布会被拦住。
// 改判定规则 → src/lib/schema/validate.ts；改模拟 → src/lib/simulate.ts；这里只负责展示。

export default function CheckTab({
  issues,
  errorCount,
  simText,
  onRunSim,
}: {
  issues: ValidationIssue[];
  errorCount: number;
  /** 模拟报告文本，没跑过就是空串 */
  simText: string;
  onRunSim: () => void;
}): React.ReactElement {
  return (
    <div>
      <div className="pane-note" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span>
          {errorCount > 0
            ? `发现 ${errorCount} 个错误、${issues.length - errorCount} 个警告`
            : issues.length > 0
              ? `无错误，${issues.length} 个警告`
              : "校验通过，没有发现问题 ✓"}
        </span>
        <button className="btn small secondary" onClick={onRunSim}>
          模拟 200 局
        </button>
      </div>
      <div className="issues">
        {issues.map((issue, i) => (
          <div key={i} className={`issue ${issue.severity}`}>
            <div className="path">{issue.path}</div>
            {issue.message}
          </div>
        ))}
      </div>
      {simText && <div className="sim-report">{simText}</div>}
    </div>
  );
}
