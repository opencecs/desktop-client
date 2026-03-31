import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { consoleApi } from "@/api/console";
import { describeApiError, isApiErrorKind } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { PortMappingManager } from "@/components/PortMappingManager";
import { SectionCard } from "@/components/SectionCard";
import { StatusPill } from "@/components/StatusPill";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useAuthStore } from "@/stores/auth-store";

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  const isEmpty = value === null || value === undefined || value === "";
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong className={isEmpty ? "text-muted" : ""}>{isEmpty ? "未提供" : value}</strong>
    </div>
  );
}

export function InstanceDetailPage() {
  const { id } = useParams();
  const session = useAuthStore((state) => state.session);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const detailQuery = useQuery({
    queryKey: ["console", "instance", id, session?.accessToken],
    queryFn: () => consoleApi.fetchInstanceDetail(id ?? "", session?.accessToken),
    enabled: Boolean(id && session),
  });

  const startMutation = useMutation({
    mutationFn: () => consoleApi.startInstance(id ?? "", session?.accessToken),
    onSuccess: async (result) => {
      setNotice({ tone: "success", text: result.message || "实例启动请求已提交" });
      await detailQuery.refetch();
    },
    onError: (error) => setNotice({ tone: "danger", text: describeApiError(error) }),
  });

  const stopMutation = useMutation({
    mutationFn: () => consoleApi.stopInstance(id ?? "", session?.accessToken),
    onSuccess: async (result) => {
      setNotice({ tone: "success", text: result.message || "实例停止请求已提交" });
      await detailQuery.refetch();
    },
    onError: (error) => setNotice({ tone: "danger", text: describeApiError(error) }),
  });

  const rebootMutation = useMutation({
    mutationFn: () => consoleApi.rebootInstance(id ?? "", session?.accessToken),
    onSuccess: async (result) => {
      setNotice({ tone: "success", text: result.message || "实例重启请求已提交" });
      await detailQuery.refetch();
    },
    onError: (error) => setNotice({ tone: "danger", text: describeApiError(error) }),
  });

  const detail = detailQuery.data;
  const detailError = detailQuery.error;
  const isAuthError = isApiErrorKind(detailError, "auth");
  const isTimeoutError = isApiErrorKind(detailError, "timeout");

  if (detailQuery.isError) {
    return (
      <EmptyState
        title={isAuthError ? "登录已过期" : isTimeoutError ? "后端响应超时" : "实例详情加载失败"}
        description={
          isAuthError
            ? "当前会话已经失效，请重新登录后再继续。"
            : detailError instanceof Error
              ? describeApiError(detailError)
              : "无法读取实例详情"
        }
        action={
          <div className="empty-actions">
            <button className="primary-button" onClick={() => detailQuery.refetch()}>重试</button>
            {isAuthError ? (
              <Link className="ghost-button" to="/login">
                返回登录
              </Link>
            ) : null}
          </div>
        }
      />
    );
  }

  if (detailQuery.isLoading || !detail) {
    return <div className="loading-card">正在加载实例详情...</div>;
  }

  return (
    <div className="page-stack">
      <section className="hero-card detail-hero">
        <div className="hero-copy">
          <div className="eyebrow">实例详情</div>
          <h2>{detail.instanceName || detail.instanceId}</h2>
          {detail.description && <p>{detail.description}</p>}
          <div className="inline-tags" style={{ marginTop: "4px" }}>
            <StatusPill status={detail.status} />
            <span className="source-chip">{detail.ipAddress}</span>
            {detail.osName ? <span className="source-chip muted">{detail.osName}</span> : null}
          </div>
        </div>
        <div className="hero-actions">
          {/* 生命周期操作 */}
          <button className="primary-button" onClick={() => startMutation.mutate()} disabled={startMutation.isPending || ['running', 'pending'].includes(detail.status)}>
            启动
          </button>
          <button className="ghost-button" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending || !['running'].includes(detail.status)}>
            停止
          </button>
          <button className="ghost-button" onClick={() => rebootMutation.mutate()} disabled={rebootMutation.isPending || !['running'].includes(detail.status)}>
            重启
          </button>
          {/* 快捷访问 */}
          <Link className="primary-button" to={`/terminal/${detail.instanceId}`} style={{ marginLeft: "12px" }}>
            SSH 终端
          </Link>
          <Link className="ghost-button" to={`/instances/${detail.instanceId}/logs`}>
            操作日志
          </Link>
        </div>
      </section>

      {notice ? <div className={`inline-alert ${notice.tone}`}>{notice.text}</div> : null}

      <section className="detail-grid">
        <SectionCard title="硬件与系统" description="设备的硬件规格与底层系统配置。">
          <div className="info-grid">
            <InfoRow label="实例 ID" value={detail.instanceId} />
            <InfoRow label="板卡型号" value={detail.boardType} />
            {detail.boardName ? <InfoRow label="板卡名称" value={detail.boardName} /> : null}
            <InfoRow label="内存" value={detail.memory ? `${detail.memory} GB` : undefined} />
            <InfoRow label="系统盘" value={detail.diskSize !== undefined ? `${detail.diskSize} GB` : undefined} />
            {detail.imageName ? <InfoRow label="所属镜像" value={detail.imageName} /> : null}
            {detail.osName ? <InfoRow label="操作系统" value={detail.osName} /> : null}
          </div>
        </SectionCard>

        <SectionCard title="网络与计费" description="实例的连接属性和授权账单信息。">
          <div className="info-grid">
            <InfoRow label="内网 IP" value={detail.ipAddress} />
            {detail.regionName ? <InfoRow label="地域节点" value={detail.regionName} /> : null}
            <InfoRow label="计费模式" value={detail.billingMode} />
            {detail.monthlyPrice ? <InfoRow label="月预估费用" value={formatMoney(detail.monthlyPrice)} /> : null}
            {detail.bandwidth !== undefined ? (
              <InfoRow label="公网带宽" value={detail.bandwidthType ? `${detail.bandwidth} ${detail.bandwidthType}` : `${detail.bandwidth}`} />
            ) : null}
            <InfoRow label="资源创建时间" value={formatDateTime(detail.createdAt)} />
            {detail.expireAt ? <InfoRow label="资源到期时间" value={formatDateTime(detail.expireAt)} /> : null}
          </div>
        </SectionCard>
      </section>

      <PortMappingManager instanceId={detail.instanceId} token={session?.accessToken} />
    </div>
  );
}
