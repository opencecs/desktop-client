import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { consoleApi } from "@/api/console";
import { EmptyState } from "@/components/EmptyState";
import { SectionCard } from "@/components/SectionCard";
import { StatCard } from "@/components/StatCard";
import { StatusPill } from "@/components/StatusPill";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { describeApiError, isApiErrorKind } from "@/api/client";
import { daysUntil, formatDateShort } from "@/lib/format";
import { useAuthStore } from "@/stores/auth-store";
import type { InstanceSummary } from "@/types";

type StatusFilter = "all" | "running" | "stopped" | "expired";

function isVisibleDesktopInstance(instance: InstanceSummary) {
  return instance.isDesktop;
}

function matchesFilter(instance: InstanceSummary, keyword: string, status: StatusFilter) {
  if (status !== "all" && instance.status !== status) {
    return false;
  }

  if (!keyword) {
    return true;
  }

  const haystack = [
    instance.instanceId,
    instance.instanceName,
    instance.boardType,
    instance.imageName,
    instance.ipAddress,
    instance.osName,
    instance.desktopEnv,
    instance.desktopStatus,
    instance.regionName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(keyword.toLowerCase());
}

export function DashboardPage() {
  const session = useAuthStore((state) => state.session);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const dashboardQuery = useQuery({
    queryKey: ["console", "instances", session?.accessToken],
    queryFn: () => consoleApi.fetchDashboard(session?.accessToken),
    enabled: Boolean(session),
  });

  // Only show the desktop-info column when the current page actually has meaningful values.
  const desktopInstances = dashboardQuery.data?.items.filter(isVisibleDesktopInstance) ?? [];
  const visibleInstances = desktopInstances.filter((item) => matchesFilter(item, keyword, statusFilter));
  const showDesktopInfoColumn = visibleInstances.some((item) => Boolean(item.desktopEnv || item.desktopStatus));
  const stats = {
    total: dashboardQuery.data?.stats?.total ?? desktopInstances.length,
    desktop: dashboardQuery.data?.stats?.desktop ?? desktopInstances.length,
    running: dashboardQuery.data?.stats?.running ?? desktopInstances.filter((item) => item.status === "running").length,
    stopped: dashboardQuery.data?.stats?.stopped ?? desktopInstances.filter((item) => item.status === "stopped").length,
    expired: dashboardQuery.data?.stats?.expired ?? desktopInstances.filter((item) => item.status === "expired").length,
  };
  const expiringSoon = desktopInstances.filter((item) => {
    const remain = daysUntil(item.expireAt);
    return remain !== null && remain <= 30;
  }).length;
  const dashboardError = dashboardQuery.error;
  const isAuthError = isApiErrorKind(dashboardError, "auth");
  const isTimeoutError = isApiErrorKind(dashboardError, "timeout");

  return (
    <div className="page-stack">
      {/* ── 欢迎横幅 ── */}
      <section className="hero-card">
        <div className="hero-copy">
          <div className="eyebrow">Console Overview</div>
          <h2>欢迎回来，{session?.user.username ?? "用户"}</h2>
          <p>
            当前共管理 {stats.desktop} 台桌面实例，其中 {stats.running} 台运行中。
            {expiringSoon > 0 ? `有 ${expiringSoon} 台将在 30 天内到期，请注意续费。` : "所有实例状态正常。"}
          </p>
        </div>
        <div className="hero-badges">
          <span className="source-chip">{"API 数据"}</span>
          <span className="source-chip muted">仅桌面系统</span>
          <span className="source-chip muted">自动更新预留</span>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="桌面实例" value={stats.desktop} hint={`总计 ${stats.total} 台`} accent="tone-default" />
        <StatCard label="运行中" value={stats.running} hint="可直接进入控制台" accent="tone-success" />
        <StatCard label="已停止" value={stats.stopped} hint="等待启动或排查" accent="tone-warning" />
        <StatCard label="30 天内到期" value={expiringSoon} hint="建议提前处理" accent="tone-danger" />
      </section>

      <SectionCard
        title="实例列表"
        description="搜索、筛选和状态展示都在这里完成，后续可以直接扩展批量操作。"
        action={
          <input
            className="search-input"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索实例名 / IP / 系统 / 镜像"
          />
        }
      >
        <div className="filter-row">
          {(["all", "running", "stopped", "expired"] as const).map((status) => (
            <button
              key={status}
              type="button"
              className={`filter-chip ${statusFilter === status ? "is-active" : ""}`}
              onClick={() => setStatusFilter(status)}
            >
              {status === "all" ? "全部" : status === "running" ? "运行中" : status === "stopped" ? "已停止" : "已过期"}
            </button>
          ))}
        </div>

        {dashboardQuery.isLoading ? (
          <div className="loading-card">
            <LoadingSpinner size="large" label="正在加载桌面实例..." />
          </div>
        ) : dashboardQuery.isError ? (
          <EmptyState
            title={isAuthError ? "登录已过期" : isTimeoutError ? "后端响应超时" : "实例列表暂时不可用"}
            description={
              isAuthError
                ? "当前会话已经失效，请重新登录后再继续。"
                : dashboardError instanceof Error
                  ? describeApiError(dashboardError)
                  : "无法读取实例数据"
            }
            action={
              <div className="empty-actions">
                <button className="primary-button" onClick={() => dashboardQuery.refetch()}>重试</button>
                {isAuthError ? (
                  <Link className="ghost-button" to="/login">
                    返回登录
                  </Link>
                ) : null}
              </div>
            }
          />
        ) : visibleInstances.length === 0 ? (
          <EmptyState
            title="没有符合条件的桌面实例"
            description="如果后端暂时没有返回桌面系统数据，这里会保持空状态。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例</th>
                  <th>状态</th>
                  <th>IP / 系统</th>
                  {showDesktopInfoColumn ? <th>桌面信息</th> : null}
                  <th>到期</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleInstances.map((instance) => {
                  const expireDays = daysUntil(instance.expireAt);
                  return (
                    <tr key={instance.instanceId}>
                      <td>
                        <div className="row-title">{instance.instanceName}</div>
                        <div className="row-subtitle">{instance.instanceId}</div>
                      </td>
                      <td>
                        <StatusPill status={instance.status} />
                      </td>
                      <td>
                        <div className="row-title">{instance.ipAddress}</div>
                        <div className="row-subtitle">
                          {instance.osName ?? "未提供"} · {instance.boardType}
                        </div>
                      </td>
                      {showDesktopInfoColumn ? (
                        <td>
                          <>
                            {/* Avoid placeholder text here; empty values mean the upstream has not supplied real desktop metadata yet. */}
                            <div className="row-title">{instance.desktopEnv ?? ""}</div>
                            <div className="row-subtitle">{instance.desktopStatus ?? ""}</div>
                          </>
                        </td>
                      ) : null}
                      <td>
                        <div className="row-title">{formatDateShort(instance.expireAt)}</div>
                        <div className="row-subtitle">{expireDays === null ? "未知" : `${expireDays} 天后`}</div>
                      </td>
                      <td>
                        <div className="row-actions">
                          <Link className="ghost-button row-button" to={`/instances/${instance.instanceId}`}>
                            详情
                          </Link>
                          <Link className="ghost-button row-button" to={`/webrtc-screen-wall?ids=${instance.instanceId}`}>
                            桌面
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <section className="two-column-grid">
        <SectionCard title="快速入口" description="常用功能一键直达。">
          <div className="placeholder-stack">
            <Link to="/devices" className="placeholder-card link-card">
              <strong>群控面板</strong>
              <span>批量管理多台设备，一键启停与重启</span>
            </Link>
            <Link to="/screen-wall" className="placeholder-card link-card">
              <strong>投屏画面墙</strong>
              <span>VNC 画面并排展示，实时监控设备屏幕</span>
            </Link>
            <Link to="/desktop" className="placeholder-card link-card">
              <strong>桌面控制</strong>
              <span>远程桌面连接、SSH 终端与串口通信</span>
            </Link>
          </div>
        </SectionCard>

        <SectionCard title="运行摘要" description="当前桌面节点健康概况。">
          <div className="summary-list">
            <div>
              <span>API 数据源</span>
              <strong>{"真实接口"}</strong>
            </div>
            <div>
              <span>桌面系统实例</span>
              <strong>{stats.desktop}</strong>
            </div>
            <div>
              <span>即将到期</span>
              <strong>{expiringSoon}</strong>
            </div>
            <div>
              <span>可继续扩展</span>
              <strong>自动更新 / 群控 / 投屏</strong>
            </div>
          </div>
        </SectionCard>


      </section>
    </div>
  );
}
