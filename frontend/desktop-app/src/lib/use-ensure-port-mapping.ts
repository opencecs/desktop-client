/**
 * useEnsurePortMapping — 自动确保端口映射存在的 Hook
 * 页面加载时检查指定私网端口是否已有映射，若没有则自动创建。
 * 返回 { natPublicIp, publicPort, isReady, isCreating, error }
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { consoleApi } from "@/api/console";

interface EnsurePortMappingResult {
  /** NAT 公网 IP */
  natPublicIp: string;
  /** 映射后的公网端口 */
  publicPort: number;
  /** 数据已就绪（映射存在或已创建） */
  isReady: boolean;
  /** 正在自动创建映射中 */
  isCreating: boolean;
  /** 错误信息 */
  error: string;
}

/**
 * 自动确保指定端口映射存在
 * @param instanceId 实例 ID
 * @param token      认证 token
 * @param privatePort 需要映射的私网端口（如 22、5900）
 * @param remark      映射备注（如 "SSH"、"VNC"）
 */
export function useEnsurePortMapping(
  instanceId: string,
  token: string,
  privatePort: number,
  remark: string,
): EnsurePortMappingResult {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  // 防止重复创建
  const creatingRef = useRef(false);

  // 查询端口映射概览（获取公网 IP）
  const { data: overview } = useQuery({
    queryKey: ["portMappingOverview", instanceId],
    queryFn: () => consoleApi.fetchPortMappingOverview(instanceId, token),
    enabled: !!instanceId && !!token,
  });

  // 查询端口映射列表（不过滤协议，由前端自行筛选，避免大小写或协议名差异导致漏查）
  const { data: mappingList, isSuccess: listReady } = useQuery({
    queryKey: ["portMappingList", instanceId],
    queryFn: () => consoleApi.fetchPortMappings(instanceId, token),
    enabled: !!instanceId && !!token,
  });

  // 查找目标端口的映射规则（协议名已被 normalize 为大写，做大小写不敏感比较）
  const targetMapping = mappingList?.items?.find(
    (r) => r.privatePort === privatePort && r.protocol.toUpperCase() === "TCP",
  );

  const natPublicIp = overview?.natPublicIp ?? "";

  // 自动创建缺失的端口映射
  const autoCreate = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setIsCreating(true);
    setError("");

    console.log(`[PortMapping] 自动创建端口映射: ${remark} (privatePort=${privatePort})`);
    try {
      const created = await consoleApi.createPortMapping(
        instanceId,
        { protocol: "tcp", privatePort, remark },
        token,
      );
      console.log(`[PortMapping] 端口映射创建成功`, {
        mappingId: created.mappingId,
        publicPort: created.publicPort,
        privatePort: created.privatePort,
      });
      // 刷新映射列表和概览缓存
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["portMappingList", instanceId] }),
        queryClient.invalidateQueries({ queryKey: ["portMappingOverview", instanceId] }),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "创建端口映射失败";
      // 若上游提示"已存在"（重复添加），则直接刷新列表获取已有的映射，不报错
      const isDuplicate = msg.includes("已存在") || msg.includes("重复") || msg.includes("duplicate") || msg.includes("already");
      if (isDuplicate) {
        console.warn(`[PortMapping] 映射已存在，刷新列表获取数据`, { privatePort });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["portMappingList", instanceId] }),
          queryClient.invalidateQueries({ queryKey: ["portMappingOverview", instanceId] }),
        ]);
      } else {
        console.error(`[PortMapping] 自动创建端口映射失败:`, msg);
        setError(msg);
      }
    } finally {
      setIsCreating(false);
      creatingRef.current = false;
    }
  }, [instanceId, token, privatePort, remark, queryClient]);

  // 列表加载完成后，如果映射不存在，自动创建
  useEffect(() => {
    if (listReady && !targetMapping && !creatingRef.current && instanceId && token) {
      autoCreate();
    }
  }, [listReady, targetMapping, autoCreate, instanceId, token]);

  return {
    natPublicIp,
    publicPort: targetMapping?.publicPort ?? 0,
    isReady: !!natPublicIp && !!targetMapping,
    isCreating,
    error,
  };
}
