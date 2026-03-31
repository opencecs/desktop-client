import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="not-found">
      <h2>页面不存在</h2>
      <p>当前地址没有匹配到有效路由。</p>
      <Link className="primary-button" to="/">
        返回总览
      </Link>
    </div>
  );
}
