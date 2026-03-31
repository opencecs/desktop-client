/**
 * 操作日志页面 — 查看实例的操作历史记录
 * URL: /instances/:instanceId/logs
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { consoleApi } from "@/api/console";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Alert } from "@/components/ui/Alert";

/** 每页日志条数 */
const PAGE_SIZE = 20;

/**
 * 操作日志页面组件
 */
export function OpLogsPage() {
  const { instanceId = "" } = useParams<{ instanceId: string }>();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.session?.accessToken);

  const [page, setPage] = useState(1);

  // ── 日志查询 ──
  const { data, isLoading, error } = useQuery({
    queryKey: ["op-logs", instanceId, page],
    queryFn: () => consoleApi.fetchOpLogs(instanceId, page, PAGE_SIZE, token),
    enabled: !!instanceId,
    staleTime: 10_000,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  if (isLoading) {
    return <div className="page-loading"><LoadingSpinner label="加载操作日志..." /></div>;
  }

  if (error) {
    return <div className="page-error"><Alert type="error" message={error instanceof Error ? error.message : "加载失败"} /></div>;
  }

  return (
    <div className="op-logs-page">
      <div className="op-logs-header">
        <Button variant="ghost" onClick={() => navigate(-1)}>← 返回</Button>
        <h2>操作日志</h2>
        <span className="op-logs-total">共 {data?.total ?? 0} 条</span>
      </div>

      {/* 日志表格 */}
      {data && data.items.length > 0 ? (
        <div className="op-logs-table-wrap">
          <table className="op-logs-table">
            <thead>
              <tr>
                <th>操作</th>
                <th>状态</th>
                <th>操作人</th>
                <th>详情</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((log) => (
                <tr key={log.logId}>
                  <td className="op-logs-action">{log.action}</td>
                  <td>
                    <span className={`op-logs-status op-logs-status-${log.status}`}>
                      {log.status}
                    </span>
                  </td>
                  <td>{log.operator ?? "—"}</td>
                  <td className="op-logs-detail" title={log.detail}>{log.detail ?? "—"}</td>
                  <td className="op-logs-time">{log.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="op-logs-empty">暂无操作日志</div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="op-logs-pagination">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <span className="op-logs-page-info">{page} / {totalPages}</span>
          <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
