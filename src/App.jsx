import Overview from './features/overview/Overview.jsx';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Gateway from './Gateway.jsx';
import Server from './Server.jsx';
import { useClock } from './shared.jsx';
import Icon from './components/Icon.jsx';
import LogViewer from './features/logs/LogViewer.jsx';

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
function currentRoute() {
  const value = location.hash.slice(1);
  // Preserve bookmarks to the original node monitoring page.
  if (value === 'server') return 'server/monitor';
  return pages.some(([path]) => path === value) ? value : 'overview';
}
const ServerPage = memo(Server),
  GatewayPage = memo(Gateway),
  LogPage = memo(LogViewer);
function Clock() {
  const now = useClock();
  return (
    <time className="workspace-clock" dateTime={new Date(now).toISOString()}>
      <Icon name="clock" size={15} />
      {new Date(now).toLocaleString('zh-CN', { hour12: false })}
    </time>
  );
}
export default function App() {
  const [route, setRoute] = useState(currentRoute),
    [gatewaySummary, setGatewaySummary] = useState(null),
    [navOpen, setNavOpen] = useState(false);
  const sidebar = useRef(null),
    menuButton = useRef(null);
  useEffect(() => {
    const listener = () => {
      setRoute(currentRoute());
      setNavOpen(false);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = sidebar.current;
    let focusFrame;
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
    const media = window.matchMedia('(max-width: 900px)');
    const resize = () => {
      if (!media.matches) setNavOpen(false);
    };
    media.addEventListener('change', resize);
    document.addEventListener('keydown', close);
    return () => {
      document.body.style.overflow = previous;
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', close);
      media.removeEventListener('change', resize);
    };
  }, [navOpen]);
  const server = route.startsWith('server/') && route !== 'server/logs',
    current = pages.find(([path]) => path === route);
  const navigate = useCallback((path) => {
    location.hash = path;
  }, []);
  return (
    <>
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
        <main>
          <div hidden={route !== 'overview'}>
            <Overview active={route === 'overview'} gateway={gatewaySummary} />
          </div>
          <div hidden={!server}>
            <ServerPage
              active={server}
              page={server ? route.split('/')[1] : null}
              navigate={navigate}
            />
          </div>
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
