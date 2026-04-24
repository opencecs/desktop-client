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
  /** TCP 映射后的公网端口 */
  publicPort: number;
  /** UDP 映射后的公网端口（WebRTC ICE 需要） */
  udpPublicPort: number;
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
 * @param privatePort 需要映射的私网端口（如 22、5900、8077）
 * @param remark      映射备注（如 "SSH"、"VNC"、"WebRTC投屏"）
 * @param protocols   需要映射的协议列表，默认 ["tcp"]；WebRTC 需要 ["tcp", "udp"]
 */
export function useEnsurePortMapping(
  instanceId: string,
  token: string,
  privatePort: number,
  remark: string,
  protocols: string[] = ["tcp"],
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

  // 查询端口映射列表
  const { data: mappingList, isSuccess: listReady } = useQuery({
    queryKey: ["portMappingList", instanceId],
    queryFn: () => consoleApi.fetchPortMappings(instanceId, token),
    enabled: !!instanceId && !!token,
  });

  // 查找目标端口的 TCP 映射（用于返回公网端口）
  const tcpMapping = mappingList?.items?.find(
    (r) => r.privatePort === privatePort && r.protocol.toUpperCase() === "TCP",
  );

  // 查找目标端口的 UDP 映射（WebRTC ICE 需要）
  const udpMapping = mappingList?.items?.find(
    (r) => r.privatePort === privatePort && r.protocol.toUpperCase() === "UDP",
  );

  // 检查所有需要的协议是否都已映射
  const missingProtocols = protocols.filter((proto) =>
    !mappingList?.items?.find(
      (r) => r.privatePort === privatePort && r.protocol.toUpperCase() === proto.toUpperCase(),
    ),
  );

  const natPublicIp = overview?.natPublicIp ?? "";

  // 自动创建缺失的端口映射
  const autoCreate = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setIsCreating(true);
    setError("");

    try {
      for (const proto of missingProtocols) {
        console.log(`[PortMapping] 自动创建端口映射: ${remark} (privatePort=${privatePort}, protocol=${proto})`);
        try {
          const created = await consoleApi.createPortMapping(
            instanceId,
            { protocol: proto, privatePort, remark },
            token,
          );
          console.log(`[PortMapping] 端口映射创建成功`, {
            mappingId: created.mappingId,
            publicPort: created.publicPort,
            privatePort: created.privatePort,
            protocol: proto,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "创建端口映射失败";
          const isDuplicate = msg.includes("已存在") || msg.includes("重复") || msg.includes("duplicate") || msg.includes("already");
          if (!isDuplicate) {
            throw e;
          }
          console.warn(`[PortMapping] ${proto.toUpperCase()} 映射已存在，跳过`, { privatePort });
        }
      }
      // 刷新映射列表和概览缓存
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["portMappingList", instanceId] }),
        queryClient.invalidateQueries({ queryKey: ["portMappingOverview", instanceId] }),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "创建端口映射失败";
      console.error(`[PortMapping] 自动创建端口映射失败:`, msg);
      setError(msg);
    } finally {
      setIsCreating(false);
      creatingRef.current = false;
    }
  }, [instanceId, token, privatePort, remark, missingProtocols, queryClient]);

  // 列表加载完成后，如果有缺失的映射，自动创建
  useEffect(() => {
    if (listReady && missingProtocols.length > 0 && !creatingRef.current && instanceId && token) {
      autoCreate();
    }
  }, [listReady, missingProtocols.length, autoCreate, instanceId, token]);

  return {
    natPublicIp,
    publicPort: tcpMapping?.publicPort ?? 0,
    udpPublicPort: udpMapping?.publicPort ?? 0,
    isReady: !!natPublicIp && missingProtocols.length === 0 && !!tcpMapping,
    isCreating,
    error,
  };
}
