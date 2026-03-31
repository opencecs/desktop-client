import { describe, expect, it } from "vitest";
import { consoleApiTestUtils } from "@/api/console";

describe("consoleApi normalization", () => {
  it("defaults desktop classification to true when upstream flag is absent", () => {
    const instance = consoleApiTestUtils.normalizeInstance({
      instance_id: "inst-1",
      instance_name: "RK3588 Desktop",
      board_type: "rk3588",
      status: "running",
    });

    expect(instance.isDesktop).toBeUndefined();
    expect(instance.isDesktopSystem).toBe(true);
  });

  it("prefers explicit is_desktop=false when upstream provides it", () => {
    const instance = consoleApiTestUtils.normalizeInstance({
      instance_id: "inst-2",
      instance_name: "Compute Node",
      board_type: "x86_64",
      is_desktop: false,
      is_desktop_system: true,
    });

    expect(instance.isDesktop).toBe(false);
    expect(instance.isDesktopSystem).toBe(true);
  });

  it("normalizes login payload fields returned directly by the auth endpoint", () => {
    const session = consoleApiTestUtils.normalizeSession({
      user_id: "user-9",
      username: "alice",
      phone: "13800138000",
      email: "alice@example.com",
      user_type: "professional",
      is_verified: true,
      token: "jwt-token",
      expire_time: 1770000000,
    }, "api");

    expect(session.user.userId).toBe("user-9");
    expect(session.user.username).toBe("alice");
    expect(session.user.phone).toBe("13800138000");
    expect(session.user.email).toBe("alice@example.com");
    expect(session.user.userType).toBe("professional");
    expect(session.user.isVerified).toBe(true);
    expect(session.expireTime).toBe(1770000000);
    expect(session.expiresAt).toBe(new Date(1770000000 * 1000).toISOString());
  });

  it("normalizes action responses with fallback fields", () => {
    const result = consoleApiTestUtils.normalizeActionResult("inst-3", {
      instanceId: "inst-3",
      state: "queued",
      detail: "accepted",
    }, "fallback");

    expect(result).toEqual({
      instanceId: "inst-3",
      status: "queued",
      message: "accepted",
    });
  });

  it("normalizes nested detail payloads and console url aliases", () => {
    const detail = consoleApiTestUtils.normalizeDetail({
      instance: {
        instance_id: "inst-4",
        instance_name: "Desktop Node",
        board_type: "rk3588s",
        url: "https://console.local/session",
        network_status: "normal",
      },
    });

    expect(detail.instanceId).toBe("inst-4");
    expect(detail.boardType).toBe("rk3588s");
    expect(detail.networkStatus).toBe("normal");
    expect(detail.consoleUrl).toBe("https://console.local/session");
  });

  it("normalizes port mapping overview and list payloads", () => {
    const overview = consoleApiTestUtils.normalizePortMappingOverview({
      data: {
        instance_id: "inst-5",
        private_ip: "10.0.0.8",
        nat_public_ip: "203.0.113.10",
        tcp: { used: 2, quota: 20, active_count: 2, failed_count: 0 },
        udp: { used: 1, quota: 10, active_count: 0, failed_count: 1 },
      },
    });

    const list = consoleApiTestUtils.normalizePortMappingList({
      data: {
        total: 1,
        list: [
          {
            mapping_id: "pm-001",
            protocol: "TCP",
            public_port: 40222,
            private_port: 22,
            proxy_status: "ok",
          },
        ],
      },
    });

    expect(overview.instanceId).toBe("inst-5");
    expect(overview.tcp.activeCount).toBe(2);
    expect(list.total).toBe(1);
    expect(list.items[0]?.publicPort).toBe(40222);
  });

  it("normalizes port mapping batch and delete responses", () => {
    const createResult = consoleApiTestUtils.normalizePortMappingBatchCreateResult({
      data: {
        total: 2,
        succeeded: 1,
        failed: 1,
        results: [
          {
            index: 0,
            success: true,
            data: {
              mapping_id: "pm-001",
              protocol: "tcp",
              public_port: 40022,
              private_port: 22,
            },
          },
          {
            index: 1,
            success: false,
            reason: "duplicate",
          },
        ],
      },
    });

    const deleteResult = consoleApiTestUtils.normalizePortMappingBatchDeleteResult({
      data: {
        total: 2,
        succeeded: 2,
        failed: 0,
        results: [
          { mapping_id: "pm-001", success: true },
          { mapping_id: "pm-002", success: true },
        ],
      },
    });

    const singleDelete = consoleApiTestUtils.normalizePortMappingDeleteResult({
      data: {
        mapping_id: "pm-003",
        message: "deleted",
      },
    }, "pm-003");

    expect(createResult.results[0]?.data?.protocol).toBe("TCP");
    expect(createResult.failed).toBe(1);
    expect(deleteResult.succeeded).toBe(2);
    expect(singleDelete.message).toBe("deleted");
  });
});
