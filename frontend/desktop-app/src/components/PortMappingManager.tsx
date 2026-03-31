import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { consoleApi } from "@/api/console";
import { describeApiError, isApiErrorKind } from "@/api/client";
import { SectionCard } from "@/components/SectionCard";
import { createLogger } from "@/lib/logger";
import { buildPortMappingBatchPayload, normalizePortMappingProtocolFilter, parsePortMappingBatchText, type PortMappingProtocolFilter } from "@/lib/port-mapping";
import { formatDateTime } from "@/lib/format";
import type { PortMappingRule } from "@/types";

type NoticeTone = "success" | "danger";

interface PortMappingManagerProps {
  instanceId: string;
  token?: string;
}

function parsePrivatePort(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export function PortMappingManager({ instanceId, token }: PortMappingManagerProps) {
  const queryClient = useQueryClient();
  const logger = useMemo(() => createLogger("port-mapping-ui"), []);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [protocolFilter, setProtocolFilter] = useState<PortMappingProtocolFilter>("ALL");
  const [createProtocol, setCreateProtocol] = useState("TCP");
  const [privatePort, setPrivatePort] = useState("");
  const [remark, setRemark] = useState("");
  const [editingRule, setEditingRule] = useState<PortMappingRule | null>(null);
  const [batchText, setBatchText] = useState("TCP,22,SSH\nTCP,8080,HTTP");
  const [selectedMappingIds, setSelectedMappingIds] = useState<Set<string>>(new Set());

  const normalizedFilter = normalizePortMappingProtocolFilter(protocolFilter);
  const protocolQueryKey = ["console", "instance", instanceId, "port-mappings", normalizedFilter, token] as const;
  const overviewQueryKey = ["console", "instance", instanceId, "port-mappings", "overview", token] as const;

  const overviewQuery = useQuery({
    queryKey: overviewQueryKey,
    queryFn: () => consoleApi.fetchPortMappingOverview(instanceId, token),
    enabled: Boolean(instanceId && token),
  });

  const listQuery = useQuery({
    queryKey: protocolQueryKey,
    queryFn: () => consoleApi.fetchPortMappings(instanceId, token, normalizedFilter),
    enabled: Boolean(instanceId && token),
  });

  const visibleRules = listQuery.data?.items ?? [];
  const selectedCount = selectedMappingIds.size;
  const allVisibleSelected = visibleRules.length > 0 && visibleRules.every((rule) => selectedMappingIds.has(rule.mappingId));

  const refreshQueries = async () => {
    // Keep the overview and rule list in sync after any write action.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: overviewQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["console", "instance", instanceId, "port-mappings"] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: (payload: { protocol: string; privatePort: number; remark?: string }) =>
      consoleApi.createPortMapping(instanceId, payload, token),
    onSuccess: async (result) => {
      logger.info("port-mapping:create:success", { instanceId, mappingId: result.mappingId });
      setNotice({ tone: "success", text: "端口映射已创建" });
      setEditingRule(null);
      setCreateProtocol("TCP");
      setPrivatePort("");
      setRemark("");
      await refreshQueries();
    },
    onError: (error) => {
      logger.warn("port-mapping:create:error", { instanceId, error: String(error) });
      setNotice({ tone: "danger", text: describeApiError(error) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { mappingId: string; privatePort?: number; remark?: string }) =>
      consoleApi.updatePortMapping(instanceId, payload.mappingId, { privatePort: payload.privatePort, remark: payload.remark }, token),
    onSuccess: async (result) => {
      logger.info("port-mapping:update:success", { instanceId, mappingId: result.mappingId });
      setNotice({ tone: "success", text: "端口映射已更新" });
      setEditingRule(null);
      setCreateProtocol("TCP");
      setPrivatePort("");
      setRemark("");
      await refreshQueries();
    },
    onError: (error) => {
      logger.warn("port-mapping:update:error", { instanceId, error: String(error) });
      setNotice({ tone: "danger", text: describeApiError(error) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (mappingId: string) => consoleApi.deletePortMapping(instanceId, mappingId, token),
    onSuccess: async (result) => {
      logger.info("port-mapping:delete:success", { instanceId, mappingId: result.mappingId });
      setNotice({ tone: "success", text: result.message || "端口映射已删除" });
      setSelectedMappingIds((current) => {
        const next = new Set(current);
        next.delete(result.mappingId);
        return next;
      });
      await refreshQueries();
    },
    onError: (error) => {
      logger.warn("port-mapping:delete:error", { instanceId, error: String(error) });
      setNotice({ tone: "danger", text: describeApiError(error) });
    },
  });

  const batchCreateMutation = useMutation({
    mutationFn: (payload: { rules: { protocol: string; privatePort: number; remark?: string }[] }) =>
      consoleApi.batchCreatePortMappings(instanceId, buildPortMappingBatchPayload(payload.rules), token),
    onSuccess: async (result) => {
      logger.info("port-mapping:batch-create:success", { instanceId, succeeded: result.succeeded, failed: result.failed });
      setNotice({ tone: "success", text: `批量创建完成：成功 ${result.succeeded} 条` });
      await refreshQueries();
    },
    onError: (error) => {
      logger.warn("port-mapping:batch-create:error", { instanceId, error: String(error) });
      setNotice({ tone: "danger", text: describeApiError(error) });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (mappingIds: string[]) => consoleApi.batchDeletePortMappings(instanceId, mappingIds, token),
    onSuccess: async (result) => {
      logger.info("port-mapping:batch-delete:success", { instanceId, succeeded: result.succeeded, failed: result.failed });
      setNotice({ tone: "success", text: `批量删除完成：成功 ${result.succeeded} 条` });
      setSelectedMappingIds(new Set());
      await refreshQueries();
    },
    onError: (error) => {
      logger.warn("port-mapping:batch-delete:error", { instanceId, error: String(error) });
      setNotice({ tone: "danger", text: describeApiError(error) });
    },
  });

  function resetSingleForm() {
    // 退出编辑模式，重置表单为创建状态
    setEditingRule(null);
    setCreateProtocol("TCP");
    setPrivatePort("");
    setRemark("");
    setNotice(null);
  }

  function beginEdit(rule: PortMappingRule) {
    // The protocol is immutable for updates, so the edit form only rewrites port and remark.
    setEditingRule(rule);
    setPrivatePort(String(rule.privatePort));
    setRemark(rule.remark ?? "");
    setNotice(null);
  }

  function toggleSelected(mappingId: string) {
    setSelectedMappingIds((current) => {
      const next = new Set(current);
      if (next.has(mappingId)) {
        next.delete(mappingId);
      } else {
        next.add(mappingId);
      }
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedMappingIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleRules.forEach((rule) => next.delete(rule.mappingId));
      } else {
        visibleRules.forEach((rule) => next.add(rule.mappingId));
      }
      return next;
    });
  }

  async function handleSingleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const parsedPort = parsePrivatePort(privatePort);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setNotice({ tone: "danger", text: "请输入有效的内网端口（1-65535）" });
      return;
    }

    if (editingRule) {
      await updateMutation.mutateAsync({
        mappingId: editingRule.mappingId,
        privatePort: parsedPort,
        remark: remark.trim() || undefined,
      });
      return;
    }

    const protocol = normalizedFilter === "TCP" || normalizedFilter === "UDP" ? normalizedFilter : normalizePortMappingProtocolFilter(createProtocol);
    if (protocol === "ALL") {
      setNotice({ tone: "danger", text: "请选择协议：TCP 或 UDP" });
      return;
    }

    await createMutation.mutateAsync({
      protocol,
      privatePort: parsedPort,
      remark: remark.trim() || undefined,
    });
  }

  async function handleBatchCreate() {
    setNotice(null);
    const parsed = parsePortMappingBatchText(batchText);
    if (parsed.errors.length > 0) {
      setNotice({ tone: "danger", text: parsed.errors[0] });
      return;
    }

    if (parsed.rules.length === 0) {
      setNotice({ tone: "danger", text: "请先填写至少一条批量创建规则" });
      return;
    }

    await batchCreateMutation.mutateAsync({ rules: parsed.rules });
  }

  async function handleBatchDelete() {
    if (selectedCount === 0) {
      setNotice({ tone: "danger", text: "请先勾选要删除的端口映射" });
      return;
    }

    if (!window.confirm(`确认删除选中的 ${selectedCount} 条端口映射吗？`)) {
      return;
    }

    await batchDeleteMutation.mutateAsync(Array.from(selectedMappingIds));
  }

  const batchDraft = useMemo(() => parsePortMappingBatchText(batchText), [batchText]);

  const overviewLoading = overviewQuery.isLoading;
  const listLoading = listQuery.isLoading;
  const overviewError = overviewQuery.error;
  const listError = listQuery.error;
  const isAuthError = isApiErrorKind(overviewError ?? listError, "auth");

  return (
    <SectionCard
      title="端口映射管理"
      description="支持协议过滤、单条增删改、批量创建和批量删除。"
      action={
        <div className="filter-row">
          {(["ALL", "TCP", "UDP"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`filter-chip ${protocolFilter === item ? "is-active" : ""}`}
              onClick={() => {
                logger.debug("port-mapping:filter", { instanceId, protocol: item });
                setProtocolFilter(item);
                setSelectedMappingIds(new Set());
              }}
            >
              {item === "ALL" ? "全部协议" : item}
            </button>
          ))}
        </div>
      }
    >
      {notice ? <div className={`inline-alert ${notice.tone}`}>{notice.text}</div> : null}
      {/* 上游业务错误警告（如内网IP未配置），以黄色提示展示 */}
      {overviewQuery.data && (overviewQuery.data as any)._warning ? (
        <div className="inline-alert warning">⚠ {(overviewQuery.data as any)._warning}</div>
      ) : null}
      {overviewLoading ? (
        <div className="loading-card">正在加载端口映射概览...</div>
      ) : overviewError ? (
        <div className={`inline-alert ${isAuthError ? "danger" : ""}`}>{describeApiError(overviewError)}</div>
      ) : overviewQuery.data ? (
        <div className="summary-list wide">
          <div>
            <span>内网地址</span>
            <strong className={!overviewQuery.data.privateIp ? "text-muted" : ""}>
              {overviewQuery.data.privateIp ?? "未配置"}
            </strong>
          </div>
          <div>
            <span>公网地址</span>
            <strong>{overviewQuery.data.natPublicIp ?? "未提供"}</strong>
          </div>
          <div>
            <span>TCP 使用 / 配额</span>
            <strong>{`${overviewQuery.data.tcp.used} / ${overviewQuery.data.tcp.quota}`}</strong>
          </div>
          <div>
            <span>UDP 使用 / 配额</span>
            <strong>{`${overviewQuery.data.udp.used} / ${overviewQuery.data.udp.quota}`}</strong>
          </div>
          <div>
            <span>TCP 正常 / 异常</span>
            <strong>{`${overviewQuery.data.tcp.activeCount} / ${overviewQuery.data.tcp.failedCount}`}</strong>
          </div>
          <div>
            <span>UDP 正常 / 异常</span>
            <strong>{`${overviewQuery.data.udp.activeCount} / ${overviewQuery.data.udp.failedCount}`}</strong>
          </div>
        </div>
      ) : (
        <div className="inline-alert">端口映射概览暂未返回</div>
      )}

      <div className={`port-mapping-panel ${editingRule ? "is-editing" : ""}`}>
        <div className="section-card-head compact">
          <div>
            <h2>{editingRule ? `编辑映射 ${editingRule.mappingId}` : "单条创建"}</h2>
            <p>{editingRule ? `正在编辑 ${editingRule.protocol} :${editingRule.publicPort} → :${editingRule.privatePort}` : "选择协议、内网端口和备注来创建新映射。"}</p>
          </div>
          <div className="section-card-action">
            {editingRule ? (
              <button type="button" className="ghost-button" onClick={resetSingleForm}>
                取消编辑
              </button>
            ) : null}
          </div>
        </div>
        <form className="port-mapping-form" onSubmit={handleSingleSubmit}>
          <div className="port-mapping-form-grid">
            {editingRule ? (
              <div className="port-mapping-readonly">
                <span>协议</span>
                <strong>{editingRule.protocol}</strong>
              </div>
            ) : (
              <label>
                <span>协议</span>
                <select className="port-mapping-field" value={createProtocol} onChange={(event) => setCreateProtocol(event.target.value)}>
                  <option value="TCP">TCP</option>
                  <option value="UDP">UDP</option>
                </select>
              </label>
            )}
            <label>
              <span>内网端口</span>
              <input className="port-mapping-field" value={privatePort} onChange={(event) => setPrivatePort(event.target.value)} placeholder="22" inputMode="numeric" />
            </label>
            <label className="port-mapping-remark">
              <span>备注</span>
              <input className="port-mapping-field" value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="SSH / HTTP / WireGuard" maxLength={50} />
            </label>
          </div>
          <div className="port-mapping-form-actions">
            <button className="primary-button" type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {editingRule ? "保存修改" : "创建映射"}
            </button>
            <button type="button" className="ghost-button" onClick={resetSingleForm} disabled={createMutation.isPending || updateMutation.isPending}>
              重置
            </button>
          </div>
        </form>
      </div>

      <div className="port-mapping-panel">
        <div className="section-card-head compact">
          <div>
            <h2>批量创建</h2>
            <p>每行一条，格式支持 <code>TCP,22,SSH</code> 或 <code>UDP 51820 WireGuard</code>。</p>
          </div>
          <div className="section-card-action">
            <button type="button" className="primary-button" onClick={handleBatchCreate} disabled={batchCreateMutation.isPending}>
              批量创建
            </button>
          </div>
        </div>
        <textarea
          className="port-mapping-field port-mapping-textarea"
          value={batchText}
          onChange={(event) => setBatchText(event.target.value)}
          rows={5}
          placeholder="TCP,22,SSH"
        />
        <div className="port-mapping-form-note">
          <span>已识别 {batchDraft.rules.length} 条规则</span>
          {batchDraft.errors.length > 0 ? <span className="danger-text">{batchDraft.errors[0]}</span> : null}
        </div>
      </div>

      <div className="port-mapping-panel">
        <div className="section-card-head compact">
          <div>
            <h2>规则列表</h2>
            <p>支持单条编辑、单条删除和批量删除。</p>
          </div>
          <div className="section-card-action">
            <button type="button" className="ghost-button" onClick={handleBatchDelete} disabled={selectedCount === 0 || batchDeleteMutation.isPending}>
              批量删除 ({selectedCount})
            </button>
          </div>
        </div>

        {listLoading ? (
          <div className="loading-card">正在加载端口映射规则...</div>
        ) : listError ? (
          <div className="inline-alert danger">{describeApiError(listError)}</div>
        ) : visibleRules.length === 0 ? (
          <div className="inline-alert">当前过滤条件下没有端口映射规则</div>
        ) : (
          <>
            <div className="bulk-action-bar">
              <label className="checkbox-row">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                <span>全选当前页</span>
              </label>
              <span className="bulk-action-hint">已勾选 {selectedCount} 条</span>
            </div>

            <div className="table-wrap">
              <table className="data-table port-mapping-table">
                <thead>
                  <tr>
                    <th className="table-checkbox-cell">选择</th>
                    <th>协议</th>
                    <th>公网端口</th>
                    <th>内网端口</th>
                    <th>状态</th>
                    <th>备注</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRules.map((rule) => (
                    <tr key={rule.mappingId} className={editingRule?.mappingId === rule.mappingId ? "is-editing-row" : ""}>
                      <td className="table-checkbox-cell">
                        <input className="table-checkbox" type="checkbox" checked={selectedMappingIds.has(rule.mappingId)} onChange={() => toggleSelected(rule.mappingId)} />
                      </td>
                      <td>{rule.protocol}</td>
                      <td>{rule.publicPort}</td>
                      <td>{rule.privatePort}</td>
                      <td>
                        <div className="row-title">{rule.proxyStatus ?? "未提供"}</div>
                        {rule.failReason ? <div className="row-subtitle">{rule.failReason}</div> : null}
                      </td>
                      <td>{rule.remark || "未填写"}</td>
                      <td>{formatDateTime(rule.createdAt)}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="ghost-button row-button" onClick={() => beginEdit(rule)}>
                            修改
                          </button>
                          <button
                            type="button"
                            className="ghost-button row-button"
                            onClick={() => {
                              if (window.confirm(`确认删除端口映射 ${rule.mappingId} 吗？`)) {
                                void deleteMutation.mutateAsync(rule.mappingId);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}
