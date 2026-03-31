import type { InstanceStatus } from "@/types";

const labelMap: Record<string, string> = {
  running: "运行中",
  stopped: "已停止",
  expired: "已过期",
  pending: "处理中",
  online: "在线",
  offline: "离线",
};

export function StatusPill({ status }: { status: InstanceStatus | string }) {
  const resolved = String(status).toLowerCase();
  const label = labelMap[resolved] ?? String(status);
  const tone =
    resolved === "running" || resolved === "online"
      ? "tone-success"
      : resolved === "stopped" || resolved === "offline"
        ? "tone-muted"
        : resolved === "expired"
          ? "tone-danger"
          : "tone-warning";

  return <span className={`status-pill ${tone}`}>{label}</span>;
}
