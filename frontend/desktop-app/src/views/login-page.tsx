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
 * 包含品牌展示区（左）和登录表单（右）
 */

const REMEMBER_KEY = "dcc.login.remembered";

function readRemembered(): { username: string; password: string } | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRemembered(username: string, password: string) {
  localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username, password }));
}

function clearRemembered() {
  localStorage.removeItem(REMEMBER_KEY);
}

export function LoginPage() {
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const hydrated = useAuthStore((state) => state.hydrated);
  const setSession = useAuthStore((state) => state.setSession);
  const [mode, setMode] = useState<"login" | "register">("login");

  const saved = readRemembered();
  const [form, setForm] = useState({
    username: saved?.username ?? "",
    password: saved?.password ?? "",
    rememberMe: !!saved,
  });
  const [regForm, setRegForm] = useState({
    phone: "",
    code: "",
    agreeAll: false,
  });

  const loginMutation = useMutation({
    mutationFn: consoleApi.login,
    onSuccess: (nextSession) => {
      console.log("[LoginPage] 登录成功，跳转首页");
      if (form.rememberMe) {
        writeRemembered(form.username, form.password);
      } else {
        clearRemembered();
      }
      setSession(nextSession);
      navigate("/", { replace: true });
    },
  });

  const registerMutation = useMutation({
    mutationFn: consoleApi.register,
    onSuccess: (nextSession) => {
      console.log("[LoginPage] 注册成功，跳转首页");
      setSession(nextSession);
      navigate("/", { replace: true });
    },
  });

  // 短信验证码倒计时
  const [countdown, setCountdown] = useState(0);
  const [smsSending, setSmsSending] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const onSendSms = async () => {
    if (!regForm.phone || countdown > 0 || smsSending) return;
    setSmsSending(true);
    try {
      await consoleApi.sendVerificationCode({ channel: "sms", target: regForm.phone, scene: "register" });
      setCountdown(60);
    } catch (err) {
      console.error("[LoginPage] 发送验证码失败", err);
    } finally {
      setSmsSending(false);
    }
  };

  useEffect(() => {
    if (hydrated && session) {
      console.log("[LoginPage] 已有有效会话，自动跳转首页");
      navigate("/", { replace: true });
    }
  }, [hydrated, navigate, session]);

  const onLoginSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    loginMutation.mutate(form);
  };

  const onRegisterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    registerMutation.mutate({ phone: regForm.phone, code: regForm.code });
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

        {/* 右侧面板 */}
        <section className="login-panel">
          <div className="panel-title">
            <h2>{mode === "login" ? "登录" : "注册"}</h2>
          </div>

          {mode === "login" ? (
            <form className="login-form" onSubmit={onLoginSubmit}>
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

              <label className="remember-password-label">
                <input
                  type="checkbox"
                  checked={form.rememberMe}
                  onChange={(e) => setForm((prev) => ({ ...prev, rememberMe: e.target.checked }))}
                />
                <span>记住密码</span>
              </label>

              <Button variant="primary" type="submit" block loading={loginMutation.isPending}>
                {loginMutation.isPending ? "正在登录..." : "登录"}
              </Button>

              <p className="auth-switch-text">
                还没有账号？{" "}
                <button type="button" className="auth-switch-link" onClick={() => { setMode("register"); registerMutation.reset(); }}>
                  立即注册
                </button>
              </p>
            </form>
          ) : (
            <form className="login-form" onSubmit={onRegisterSubmit}>
              <Input
                label="手机号"
                value={regForm.phone}
                onChange={(event) => setRegForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="请输入手机号"
                autoComplete="tel"
              />
              <div className="sms-code-row">
                <Input
                  label="验证码"
                  value={regForm.code}
                  onChange={(event) => setRegForm((prev) => ({ ...prev, code: event.target.value }))}
                  placeholder="请输入验证码"
                  autoComplete="one-time-code"
                />
                <button
                  type="button"
                  className="sms-code-btn"
                  disabled={!regForm.phone || countdown > 0 || smsSending}
                  onClick={onSendSms}
                >
                  {smsSending ? "发送中..." : countdown > 0 ? `${countdown}s` : "获取验证码"}
                </button>
              </div>

              {registerMutation.isError && (
                <Alert
                  type="error"
                  message={registerMutation.error instanceof Error ? registerMutation.error.message : "注册失败，请稍后重试"}
                />
              )}

              <div className="agreement-checkboxes">
                <label className="agreement-label">
                  <input
                    type="checkbox"
                    checked={regForm.agreeAll}
                    onChange={(e) => setRegForm((prev) => ({ ...prev, agreeAll: e.target.checked }))}
                  />
                  <span>我已阅读并同意 <a href="https://www.opencecs.com/agreement/user" target="_blank" rel="noreferrer">《用户协议》</a>、<a href="https://www.opencecs.com/agreement/privacy" target="_blank" rel="noreferrer">《隐私政策》</a>、<a href="https://www.opencecs.com/agreement/service" target="_blank" rel="noreferrer">《产品服务协议》</a></span>
                </label>
              </div>

              <Button
                variant="primary"
                type="submit"
                block
                loading={registerMutation.isPending}
                disabled={!regForm.phone || !regForm.code || !regForm.agreeAll}
              >
                {registerMutation.isPending ? "正在注册..." : "立即注册"}
              </Button>

              <p className="auth-switch-text">
                已有账号？{" "}
                <button type="button" className="auth-switch-link" onClick={() => { setMode("login"); loginMutation.reset(); }}>
                  返回登录
                </button>
              </p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
