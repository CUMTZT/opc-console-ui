/**
 * 工作空间外壳：管理 Hash 路由、桌面导航、移动端抽屉及系统总览需要的网关摘要。
 * 本项目没有使用 React Router；修改 URL 的 # 后内容，再监听 hashchange 更新 state。
 * 页面通过 props 接收 active/page；组件仍在树中时，切换导航可以保留其内部 state。
 */
import Overview from './features/overview/Overview.jsx';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Gateway from './Gateway.jsx';
import Server from './Server.jsx';
import { useClock } from './shared.jsx';
import Icon from './components/Icon.jsx';
import LogViewer from './features/logs/LogViewer.jsx';

// 每项依次是 [Hash 路径, 页面名称, 导航分组]，面包屑和侧栏共用这份页面表。
const pages = [
  ['overview', '系统总览', '工作空间'],
  ['server/overview', '运行总览', '模拟服务'],
  ['server/configuration', '模拟配置', '模拟服务'],
  ['server/monitor', '数据监控', '模拟服务'],
  ['server/logs', '运行日志', '模拟服务'],
  ['gateway/overview', '运行总览', '采集网关'],
  ['gateway/nodes', '节点监控', '采集网关'],
  ['gateway/connections', '连接配置', '采集网关'],
  ['gateway/settings', '网关设置', '采集网关'],
  ['gateway/logs', '运行日志', '采集网关'],
];
// 路由与图标名称的查找表：名称交给 Icon 组件，在 shapes 表中查找对应 SVG 图形。
const pageIcons = {
  overview: 'grid',
  'server/overview': 'activity',
  'server/configuration': 'sliders',
  'server/monitor': 'database',
  'server/logs': 'fileText',
  'gateway/overview': 'activity',
  'gateway/nodes': 'database',
  'gateway/connections': 'network',
  'gateway/settings': 'settings',
  'gateway/logs': 'fileText',
};
/** 读取并规范化地址：移除开头 #，兼容旧地址，再校验它是否属于已登记页面。 */
function currentRoute() {
  const value = location.hash.slice(1);
  // 兼容旧书签；未知地址统一回到总览，避免后面查找当前页面时得到 undefined。
  if (value === 'server') return 'server/monitor';
  return pages.some(([path]) => path === value) ? value : 'overview';
}
// memo 在 props 未变化时通常可跳过父组件引发的重渲染；组件自己的 state 仍可更新。
// 它是性能优化，不负责保存草稿；草稿保留来自组件在 React 树中的稳定位置。
const ServerPage = memo(Server),
  GatewayPage = memo(Gateway),
  LogPage = memo(LogViewer);
/** 时钟只拥有自己的 now 状态；同一秒的更新时间不必传播给整个工作空间。 */
function Clock() {
  // 把每秒变化的时间放进小组件，其 state 更新不会让整个 App 每秒执行一遍。
  const now = useClock();
  return (
    <time className="workspace-clock" dateTime={new Date(now).toISOString()}>
      <Icon name="clock" size={15} />
      {new Date(now).toLocaleString('zh-CN', { hour12: false })}
    </time>
  );
}
/**
 * 顶层状态归属：
 * route：当前 Hash 页面路径，决定可见区域、面包屑与导航高亮。
 * gatewaySummary：Gateway 回调上报的最近状态，转交 Overview，供兄弟区域共享。
 * navOpen：移动抽屉是否打开；不影响后端连接或配置草稿。
 * sidebar/menuButton：保存真实 DOM 引用，只用于焦点控制，不是业务数据。
 */
export default function App() {
  // useState 返回 [本次渲染的状态, 更新函数]；传函数 currentRoute 可延迟计算初始值。
  const [route, setRoute] = useState(currentRoute),
    [gatewaySummary, setGatewaySummary] = useState(null),
    [navOpen, setNavOpen] = useState(false);
  const sidebar = useRef(null),
    menuButton = useRef(null);
  // Effect 用来连接浏览器事件；空依赖数组表示挂载时订阅，卸载时执行返回的清理函数。
  useEffect(() => {
    const listener = () => {
      // 浏览器前进/后退、点击锚点和程序赋值 hash，都会从这个监听入口同步 React 状态。
      setRoute(currentRoute());
      setNavOpen(false);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  // 抽屉打开期间锁定背景滚动并接管键盘焦点；navOpen 变化时先清理旧的副作用。
  useEffect(() => {
    if (!navOpen) return;
    // 必须记住原值而不是关闭时直接写 auto：外部布局可能已有自己的 overflow 设置。
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // ref.current 在 DOM 提交后由 React 填充，此 Effect 执行时才能取到真实 aside 元素。
    const panel = sidebar.current;
    let focusFrame;
    // CSS 打开动画可能尚未让按钮可见；等到可见后再聚焦，避免焦点落到隐藏内容。
    const focusClose = () => {
      const button = panel.querySelector('.nav-close');
      if (
        button?.checkVisibility() &&
        getComputedStyle(button).visibility === 'visible'
      )
        button.focus({ preventScroll: true });
      else focusFrame = requestAnimationFrame(focusClose);
    };
    focusFrame = requestAnimationFrame(focusClose);
    const close = (event) => {
      if (event.key === 'Escape') {
        setNavOpen(false);
        menuButton.current?.focus();
      }
      if (event.key !== 'Tab') return;
      // 将 Tab / Shift+Tab 限制在抽屉内，防止键盘用户进入被遮住的工作区。
      const controls = [
        ...sidebar.current.querySelectorAll('button, a[href]'),
      ].filter((element) => element.checkVisibility());
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    // 只监听是否跨过 900px 断点；回到桌面自动收起抽屉，避免保留移动端滚动锁。
    const media = window.matchMedia('(max-width: 900px)');
    const resize = () => {
      if (!media.matches) setNavOpen(false);
    };
    media.addEventListener('change', resize);
    document.addEventListener('keydown', close);
    return () => {
      // 每次关闭或卸载都恢复原状态，避免遗留滚动锁、动画帧和全局监听器。
      document.body.style.overflow = previous;
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', close);
      media.removeEventListener('change', resize);
    };
  }, [navOpen]);
  // 日志虽然属于 server 分组，但它由独立 LogPage 实例渲染，不属于 Server 的三个子页。
  const server = route.startsWith('server/') && route !== 'server/logs',
    // current 是 [路径, 页面名, 分组名]；由已规范化 route 查找，因此可供面包屑直接取下标。
    current = pages.find(([path]) => path === route);
  // 稳定的函数引用可配合 memo；这里只改地址，真正的路由状态由 hashchange 同步。
  const navigate = useCallback((path) => {
    location.hash = path;
  }, []);
  // JSX 中 {} 放 JavaScript 表达式；map 生成重复结构，key 帮 React 识别同一项。
  // 下方 hidden 只影响显示，不会卸载 ServerPage / GatewayPage / 两个 LogPage 实例。
  // 隐藏不会自动停止 Effect，所以各页面还需要用 active 控制网络请求。
  // Gateway 的 observe 让它在系统总览页继续读摘要，再经 onStatus 把数据交回 App。
  return (
    <>
      {/* 抽屉遮罩只在打开时创建。点击它先改状态关闭，再把键盘焦点还给菜单按钮。 */}
      {navOpen && (
        <button
          className="nav-overlay"
          aria-label="关闭导航遮罩"
          onClick={() => {
            setNavOpen(false);
            menuButton.current?.focus();
          }}
        />
      )}
      {/* 侧栏固定挂载，className 随 navOpen 添加 is-open，具体位移动画由 CSS 定义。 */}
      <aside
        ref={sidebar}
        id="workspace-navigation"
        className={`sidebar ${navOpen ? 'is-open' : ''}`}
      >
        <div className="sidebar-brand">
          <a className="brand" href="#overview">
            <span className="brand-mark">
              <Icon name="network" size={24} />
            </span>
            <span>
              OPC Studio<small>工业仿真与数采工作台</small>
            </span>
          </a>
          <button
            className="icon-button nav-close"
            aria-label="关闭导航"
            onClick={() => {
              setNavOpen(false);
              menuButton.current?.focus();
            }}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="sidebar-caption">工作空间</div>
        {/* nav 上用事件冒泡统一处理链接点击；closest 可识别点击文字或内部图标的情况。 */}
        <nav
          className="main-nav"
          aria-label="主导航"
          onClick={(event) => {
            if (event.target.closest('a')) setNavOpen(false);
          }}
        >
          <a
            className={`nav-item nav-root ${route === 'overview' ? 'active' : ''}`}
            href="#overview"
            aria-current={route === 'overview' ? 'page' : undefined}
          >
            <Icon name="grid" />
            系统总览
          </a>
          {/* 先遍历导航分组，再筛选 pages。数组解构中的空位表示这里不需要读取该字段。 */}
          {['模拟服务', '采集网关'].map((group) => (
            <section className="nav-group" aria-label={group} key={group}>
              <h2
                className={`nav-group-title ${current[2] === group ? 'current' : ''}`}
              >
                <span>
                  <Icon
                    name={group === '模拟服务' ? 'cpu' : 'server'}
                    size={16}
                  />
                  {group}
                </span>
              </h2>
              <div className="nav-children">
                {pages
                  .filter(([, , parent]) => parent === group)
                  .map(([path, title]) => (
                    <a
                      className={`nav-item ${route === path ? 'active' : ''}`}
                      href={'#' + path}
                      key={path}
                      aria-current={route === path ? 'page' : undefined}
                    >
                      <Icon name={pageIcons[path]} size={16} />
                      {title}
                    </a>
                  ))}
              </div>
            </section>
          ))}
        </nav>
        <div className="side-note">
          <div className="sidebar-protocols">
            <Icon name="network" size={16} />
            <span>OPC UA</span>
            <Icon name="arrowRight" size={13} />
            <span>Kafka</span>
          </div>
          <p>设备模拟 · 数据采集 · 运行管理</p>
        </div>
      </aside>
      {/* 工作区与侧栏分开排布：头部显示当前页面，main 保存各业务组件的稳定位置。 */}
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-leading">
            <button
              ref={menuButton}
              className="icon-button nav-toggle"
              aria-label="展开导航"
              aria-expanded={navOpen}
              aria-controls="workspace-navigation"
              onClick={() => setNavOpen(true)}
            >
              <Icon name="menu" size={20} />
            </button>
            <div className="breadcrumb">
              <Icon name={pageIcons[route]} size={17} />
              <span>{current[2]}</span>
              <span className="breadcrumb-divider">/</span>
              <strong>{current[1]}</strong>
            </div>
          </div>
          <Clock />
        </header>
        {/* hidden 负责显示，active 负责业务请求；这两个条件用途不同，不能只保留其中一个。 */}
        <main>
          {/* Overview 不重新请求网关摘要，而是使用下方 Gateway 经 App 状态传来的同一份数据。 */}
          <div hidden={route !== 'overview'}>
            <Overview active={route === 'overview'} gateway={gatewaySummary} />
          </div>
          {/* 例如 server/monitor 拆出 monitor 作为 page；离开服务时 active=false 以暂停轮询。 */}
          <div hidden={!server}>
            <ServerPage
              active={server}
              page={server ? route.split('/')[1] : null}
              navigate={navigate}
            />
          </div>
          {/* observe 只在系统总览为 true：网关界面虽不显示，仍需为链路总览提供状态。 */}
          <div
            hidden={!route.startsWith('gateway/') || route === 'gateway/logs'}
          >
            <GatewayPage
              active={route.startsWith('gateway/') && route !== 'gateway/logs'}
              observe={route === 'overview'}
              onStatus={setGatewaySummary}
              page={
                route.startsWith('gateway/') ? route.split('/')[1] : 'overview'
              }
              navigate={navigate}
            />
          </div>
          {/* 两个 LogPage 是两个组件实例，各自保留筛选、游标与结果，不会共用一份 state。 */}
          <div hidden={route !== 'server/logs'}>
            <LogPage service="server" active={route === 'server/logs'} />
          </div>
          <div hidden={route !== 'gateway/logs'}>
            <LogPage service="gateway" active={route === 'gateway/logs'} />
          </div>
        </main>
      </div>
    </>
  );
}
