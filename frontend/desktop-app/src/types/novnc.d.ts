/**
 * @novnc/novnc — 最小类型声明（仅覆盖本项目用到的 RFB API）
 */
declare module "@novnc/novnc/lib/rfb.js" {
  interface RFBOptions {
    credentials?: { password?: string };
    shared?: boolean;
    repeaterID?: string;
    wsProtocols?: string[];
  }

  type SecurityFailureDetail = { status: number; reason: string };

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);

    /** 断开连接 */
    disconnect(): void;

    /** 发送 CTRL+ALT+DEL */
    sendCtrlAltDel(): void;

    /** 画面是否填满容器 */
    scaleViewport: boolean;
    /** 是否剪裁超出视口的画面 */
    clipViewport: boolean;
    /** 是否允许调整远端桌面分辨率 */
    resizeSession: boolean;
    /** 只读模式（不发送鼠标/键盘事件） */
    viewOnly: boolean;
    /** 背景色 */
    background: string;

    // 事件
    addEventListener(event: "connect", handler: (e: CustomEvent) => void): void;
    addEventListener(event: "disconnect", handler: (e: CustomEvent<{ clean: boolean }>) => void): void;
    addEventListener(event: "credentialsrequired", handler: (e: CustomEvent) => void): void;
    addEventListener(event: "securityfailure", handler: (e: CustomEvent<SecurityFailureDetail>) => void): void;
    addEventListener(event: "desktopname", handler: (e: CustomEvent<{ name: string }>) => void): void;

    removeEventListener(event: string, handler: EventListenerOrEventListenerObject): void;
  }
}
