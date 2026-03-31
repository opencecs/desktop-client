import type { PortMappingBatchCreateInput, PortMappingBatchCreateItem } from "@/types";

export type PortMappingProtocolFilter = "ALL" | "TCP" | "UDP";

function splitBatchLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return [];
  }

  if (/[,\t|]/.test(trimmed)) {
    return trimmed
      .split(/[,\t|]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return trimmed.split(/\s+/).filter(Boolean);
}

export function normalizePortMappingProtocol(value?: string | null): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "UDP" ? "UDP" : "TCP";
}

export function normalizePortMappingProtocolFilter(value?: string | null): PortMappingProtocolFilter {
  const normalized = String(value ?? "ALL").trim().toUpperCase();
  return normalized === "TCP" || normalized === "UDP" ? normalized : "ALL";
}

export function parsePortMappingBatchText(text: string): { rules: PortMappingBatchCreateItem[]; errors: string[] } {
  const rules: PortMappingBatchCreateItem[] = [];
  const errors: string[] = [];

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const parts = splitBatchLine(line);
      if (parts.length < 2) {
        errors.push(`第 ${index + 1} 行格式不正确，至少需要协议和内网端口`);
        return;
      }

      const protocol = normalizePortMappingProtocol(parts[0]);
      const port = Number(parts[1]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(`第 ${index + 1} 行内网端口无效：${parts[1]}`);
        return;
      }

      rules.push({
        protocol,
        privatePort: port,
        remark: parts.slice(2).join(" ").trim() || undefined,
      });
    });

  if (rules.length === 0 && errors.length === 0) {
    errors.push("请输入至少一条规则，每行格式示例：TCP,22,SSH");
  }

  return { rules, errors };
}

export function buildPortMappingBatchPayload(rules: PortMappingBatchCreateItem[]): PortMappingBatchCreateInput {
  return { rules };
}
