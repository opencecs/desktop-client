import { describe, expect, it } from "vitest";
import { normalizePortMappingProtocolFilter, parsePortMappingBatchText } from "@/lib/port-mapping";

describe("port mapping helpers", () => {
  it("normalizes protocol filters", () => {
    expect(normalizePortMappingProtocolFilter("tcp")).toBe("TCP");
    expect(normalizePortMappingProtocolFilter("udp")).toBe("UDP");
    expect(normalizePortMappingProtocolFilter("anything")).toBe("ALL");
  });

  it("parses batch text with comma and whitespace separators", () => {
    const parsed = parsePortMappingBatchText("TCP,22,SSH\nudp 51820 WireGuard");

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rules).toEqual([
      { protocol: "TCP", privatePort: 22, remark: "SSH" },
      { protocol: "UDP", privatePort: 51820, remark: "WireGuard" },
    ]);
  });

  it("reports invalid batch rows", () => {
    const parsed = parsePortMappingBatchText("broken-row");

    expect(parsed.rules).toHaveLength(0);
    expect(parsed.errors[0]).toContain("格式不正确");
  });
});
