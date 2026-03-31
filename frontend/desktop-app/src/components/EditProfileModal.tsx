import { useCallback, useEffect, useRef, useState } from "react";
import { consoleApi } from "@/api/console";
import { describeApiError } from "@/api/client";
import { createLogger } from "@/lib/logger";
import { useAuthStore } from "@/stores/auth-store";
import type { CurrentUser } from "@/types";

const logger = createLogger("EditProfileModal");

/** 编辑资料弹窗的激活面板类型 */
type EditPanel = "phone" | "email" | "password" | null;

interface EditProfileModalProps {
  /** 当前用户信息 */
  user: CurrentUser;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 资料更新成功后回调（触发重新拉取用户信息） */
  onUpdated: () => void;
}

/**
 * 编辑资料弹窗组件
 * 根据 API 接口判定可修改字段：手机号、邮箱、密码
 * 用户名、头像等字段为只读展示
 */
export function EditProfileModal({ user, onClose, onUpdated }: EditProfileModalProps) {
  const token = useAuthStore((s) => s.session?.accessToken);
  const overlayRef = useRef<HTMLDivElement>(null);

  // 当前展开的编辑面板
  const [activePanel, setActivePanel] = useState<EditPanel>(null);
  // 全局提示消息
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  /** 点击遮罩层关闭弹窗 */
  const onOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) {
        logger.debug("overlay:click:close");
        onClose();
      }
    },
    [onClose],
  );

  /** ESC 键关闭弹窗 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        logger.debug("esc:close");
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /** 切换编辑面板，同时清除旧消息 */
  const togglePanel = (panel: EditPanel) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
    setMessage(null);
  };

  return (
    <div className="edit-profile-overlay" ref={overlayRef} onClick={onOverlayClick}>
      <div className="edit-profile-modal">
        {/* 弹窗标题 */}
        <div className="edit-profile-header">
          <h2>编辑资料</h2>
          <button className="icon-button" type="button" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>

        {/* 全局提示 */}
        {message && (
          <div className={`edit-profile-message ${message.type}`}>
            {message.text}
          </div>
        )}

        {/* 只读字段区域 */}
        <div className="edit-profile-section">
          <h3>基本信息（只读）</h3>
          <div className="edit-profile-readonly">
            <div className="edit-profile-field">
              <span className="edit-profile-label">用户名</span>
              <span className="edit-profile-value">{user.username || "—"}</span>
            </div>
            <div className="edit-profile-field">
              <span className="edit-profile-label">用户类型</span>
              <span className="edit-profile-value">{user.userType || "—"}</span>
            </div>
            <div className="edit-profile-field">
              <span className="edit-profile-label">认证状态</span>
              <span className="edit-profile-value">
                {user.isVerified === undefined ? "—" : user.isVerified ? "已认证" : "未认证"}
              </span>
            </div>
          </div>
        </div>

        {/* 可编辑字段区域 */}
        <div className="edit-profile-section">
          <h3>可修改信息</h3>

          {/* 手机号编辑 */}
          <div className="edit-profile-editable-field">
            <div className="edit-profile-field-row">
              <div>
                <span className="edit-profile-label">手机号</span>
                <span className="edit-profile-value">{user.phone || "未绑定"}</span>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => togglePanel("phone")}
              >
                {activePanel === "phone" ? "取消" : user.phone ? "换绑" : "绑定"}
              </button>
            </div>
            {activePanel === "phone" && (
              <PhoneEditPanel
                token={token}
                onSuccess={() => {
                  logger.info("bindPhone:success");
                  setMessage({ type: "success", text: "手机号绑定成功" });
                  setActivePanel(null);
                  onUpdated();
                }}
                onError={(msg) => setMessage({ type: "error", text: msg })}
              />
            )}
          </div>

          {/* 邮箱编辑 */}
          <div className="edit-profile-editable-field">
            <div className="edit-profile-field-row">
              <div>
                <span className="edit-profile-label">邮箱</span>
                <span className="edit-profile-value">{user.email || "未绑定"}</span>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => togglePanel("email")}
              >
                {activePanel === "email" ? "取消" : user.email ? "换绑" : "绑定"}
              </button>
            </div>
            {activePanel === "email" && (
              <EmailEditPanel
                token={token}
                onSuccess={() => {
                  logger.info("bindEmail:success");
                  setMessage({ type: "success", text: "邮箱绑定成功" });
                  setActivePanel(null);
                  onUpdated();
                }}
                onError={(msg) => setMessage({ type: "error", text: msg })}
              />
            )}
          </div>

          {/* 密码修改 */}
          <div className="edit-profile-editable-field">
            <div className="edit-profile-field-row">
              <div>
                <span className="edit-profile-label">密码</span>
                <span className="edit-profile-value">••••••</span>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => togglePanel("password")}
              >
                {activePanel === "password" ? "取消" : "修改密码"}
              </button>
            </div>
            {activePanel === "password" && (
              <PasswordEditPanel
                token={token}
                onSuccess={() => {
                  logger.info("changePassword:success");
                  setMessage({ type: "success", text: "密码修改成功" });
                  setActivePanel(null);
                }}
                onError={(msg) => setMessage({ type: "error", text: msg })}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── 手机号编辑面板 ───────── */

interface PanelProps {
  token?: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

function PhoneEditPanel({ token, onSuccess, onError }: PanelProps) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 倒计时定时器
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  /** 发送短信验证码 */
  const onSendCode = async () => {
    if (!phone.trim() || phone.trim().length !== 11) {
      onError("请输入正确的11位手机号");
      return;
    }
    setSending(true);
    try {
      await consoleApi.sendVerificationCode({ target: phone.trim(), channel: "sms", scene: "bind" });
      setCountdown(60);
      logger.info("sms:sent", { phone: phone.trim() });
    } catch (err) {
      logger.error("sms:send:failed", err);
      onError(describeApiError(err));
    } finally {
      setSending(false);
    }
  };

  /** 提交绑定 */
  const onSubmit = async () => {
    if (!phone.trim() || !code.trim()) {
      onError("请填写手机号和验证码");
      return;
    }
    setSubmitting(true);
    try {
      await consoleApi.bindPhone({ phone: phone.trim(), code: code.trim() }, token);
      onSuccess();
    } catch (err) {
      logger.error("bindPhone:failed", err);
      onError(describeApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="edit-profile-panel">
      <div className="edit-profile-input-group">
        <input
          type="tel"
          className="edit-profile-input"
          placeholder="请输入手机号"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={11}
        />
        <button
          className="ghost-button"
          type="button"
          onClick={onSendCode}
          disabled={sending || countdown > 0}
        >
          {countdown > 0 ? `${countdown}s` : sending ? "发送中..." : "发送验证码"}
        </button>
      </div>
      <div className="edit-profile-input-group">
        <input
          type="text"
          className="edit-profile-input"
          placeholder="请输入验证码"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
        />
        <button
          className="primary-button"
          type="button"
          onClick={onSubmit}
          disabled={submitting}
        >
          {submitting ? "提交中..." : "确认绑定"}
        </button>
      </div>
    </div>
  );
}

/* ───────── 邮箱编辑面板 ───────── */

function EmailEditPanel({ token, onSuccess, onError }: PanelProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 倒计时定时器
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  /** 发送邮箱验证码 */
  const onSendCode = async () => {
    if (!email.trim() || !email.includes("@")) {
      onError("请输入有效的邮箱地址");
      return;
    }
    setSending(true);
    try {
      await consoleApi.sendVerificationCode({ target: email.trim(), channel: "email", scene: "bind" });
      setCountdown(60);
      logger.info("email:code:sent", { email: email.trim() });
    } catch (err) {
      logger.error("email:code:send:failed", err);
      onError(describeApiError(err));
    } finally {
      setSending(false);
    }
  };

  /** 提交绑定 */
  const onSubmit = async () => {
    if (!email.trim() || !code.trim()) {
      onError("请填写邮箱和验证码");
      return;
    }
    setSubmitting(true);
    try {
      await consoleApi.bindEmail({ email: email.trim(), code: code.trim() }, token);
      onSuccess();
    } catch (err) {
      logger.error("bindEmail:failed", err);
      onError(describeApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="edit-profile-panel">
      <div className="edit-profile-input-group">
        <input
          type="email"
          className="edit-profile-input"
          placeholder="请输入邮箱地址"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          className="ghost-button"
          type="button"
          onClick={onSendCode}
          disabled={sending || countdown > 0}
        >
          {countdown > 0 ? `${countdown}s` : sending ? "发送中..." : "发送验证码"}
        </button>
      </div>
      <div className="edit-profile-input-group">
        <input
          type="text"
          className="edit-profile-input"
          placeholder="请输入验证码"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
        />
        <button
          className="primary-button"
          type="button"
          onClick={onSubmit}
          disabled={submitting}
        >
          {submitting ? "提交中..." : "确认绑定"}
        </button>
      </div>
    </div>
  );
}

/* ───────── 密码修改面板 ───────── */

function PasswordEditPanel({ token, onSuccess, onError }: PanelProps) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /** 提交密码修改 */
  const onSubmit = async () => {
    // 前端校验
    if (!newPassword || !confirmPassword) {
      onError("请填写新密码和确认密码");
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 20) {
      onError("新密码长度需在 8-20 位之间");
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      onError("新密码需同时包含字母和数字");
      return;
    }
    if (newPassword !== confirmPassword) {
      onError("两次输入的新密码不一致");
      return;
    }

    setSubmitting(true);
    try {
      await consoleApi.changePassword(
        { oldPassword: oldPassword || undefined, newPassword, confirmPassword },
        token,
      );
      onSuccess();
    } catch (err) {
      logger.error("changePassword:failed", err);
      onError(describeApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="edit-profile-panel">
      <input
        type="password"
        className="edit-profile-input"
        placeholder="原密码（首次设置可留空）"
        value={oldPassword}
        onChange={(e) => setOldPassword(e.target.value)}
      />
      <input
        type="password"
        className="edit-profile-input"
        placeholder="新密码（8-20位，含字母和数字）"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        maxLength={20}
      />
      <input
        type="password"
        className="edit-profile-input"
        placeholder="确认新密码"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        maxLength={20}
      />
      <button
        className="primary-button"
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        style={{ alignSelf: "flex-end" }}
      >
        {submitting ? "提交中..." : "确认修改"}
      </button>
    </div>
  );
}
