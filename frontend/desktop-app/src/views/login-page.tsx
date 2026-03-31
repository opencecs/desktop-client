import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { consoleApi } from "@/api/console";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";

/**
 * 登录页面
 * 包含品牌展示区（左）和登录表单（右），支持演示模式自动填充
 */
export function LoginPage() {
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const hydrated = useAuthStore((state) => state.hydrated);
  const setSession = useAuthStore((state) => state.setSession);
  const [form, setForm] = useState({
    username: "admin",
    password: "123456",
    rememberMe: true,
  });

  const loginMutation = useMutation({
    mutationFn: consoleApi.login,
    onSuccess: (nextSession) => {
      console.log("[LoginPage] 登录成功，跳转首页");
      setSession(nextSession);
      navigate("/", { replace: true });
    },
  });

  useEffect(() => {
    if (hydrated && session) {
      console.log("[LoginPage] 已有有效会话，自动跳转首页");
      navigate("/", { replace: true });
    }
  }, [hydrated, navigate, session]);

  /** 提交登录表单 */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log("[LoginPage] 提交登录请求");
    loginMutation.mutate(form);
  };

  return (
    <div className="login-screen">
      <div className="login-backdrop" />
      <div className="login-grid">
        {/* 左侧品牌展示区 */}
        <section className="login-hero">
          <div className="eyebrow">Device Control Center</div>
          <h1>统一管理你的云端实例与桌面控制。</h1>
          <p>
            集实例管理、远程桌面、群控操作于一体的现代化控制台。
          </p>
        </section>

        {/* 右侧登录面板 */}
        <section className="login-panel">
          <div className="panel-title">
            <h2>登录</h2>
          </div>

          <form className="login-form" onSubmit={onSubmit}>
            <Input
              label="用户名"
              value={form.username}
              onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
              placeholder="请输入用户名"
              autoComplete="username"
            />
            <Input
              label="密码"
              type="password"
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="请输入密码"
              autoComplete="current-password"
            />

            {loginMutation.isError && (
              <Alert
                type="error"
                message={loginMutation.error instanceof Error ? loginMutation.error.message : "登录失败，请检查凭据"}
              />
            )}

            <Button variant="primary" type="submit" block loading={loginMutation.isPending}>
              {loginMutation.isPending ? "正在登录..." : "登录"}
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
