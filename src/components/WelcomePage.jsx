import { JbIcon } from './Icons.jsx';

/**
 * 首启欢迎页：品牌露出 + 快速开始入口，让第一次打开不再是空白工具感。
 */
export default function WelcomePage(props) {
  const { version, onNewRequest, onOpenPalette, onOpenMock, onKbd, onOpenAbout } = props;

  const actions = [
    { icon: 'file', title: '新建请求', desc: '开始你的第一个 API 调用', keys: 'Ctrl+T', onClick: onNewRequest },
    { icon: 'quick-guide', title: '命令面板', desc: '搜索集合、环境与工具', keys: 'Ctrl+K', onClick: onOpenPalette },
    { icon: 'services', title: 'Mock 服务', desc: '一键启动本地 Mock 接口', keys: '', onClick: onOpenMock },
    { icon: 'terminal', title: '快捷键速查', desc: '查看完整的键盘快捷键', keys: 'Ctrl+/', onClick: onKbd }
  ];

  return (
    <div className="welcome-page">
      <div className="welcome-hero">
        <div className="welcome-logo"><JbIcon name="galaxy" size={44} /></div>
        <h1 className="welcome-title">ReqMock</h1>
        <p className="welcome-sub">API 调试与 Mock 一体化工作台{version ? ` · v${version}` : ''}</p>
      </div>
      <div className="welcome-grid">
        {actions.map((a) => (
          <button key={a.title} className="welcome-card" onClick={a.onClick}>
            <span className="welcome-card-icon"><JbIcon name={a.icon} size={20} /></span>
            <span className="welcome-card-body">
              <span className="welcome-card-title">
                {a.title}
                {a.keys && <span className="welcome-card-keys">{a.keys}</span>}
              </span>
              <span className="welcome-card-desc">{a.desc}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="welcome-foot">
        <span>已为你准备「示例集合」与「示例环境」，可直接发送体验。</span>
        <button className="welcome-link" onClick={onOpenAbout}>关于 ReqMock</button>
      </div>
    </div>
  );
}
