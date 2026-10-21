import Overview from './features/overview/Overview.jsx';
import { memo, useCallback, useEffect, useState } from 'react';
import Gateway from './Gateway.jsx';
import Server from './Server.jsx';
import { useClock } from './shared.jsx';

const pages = [
  ['overview', '系统总览', '工作空间'],
  ['server/overview', '总览', '模拟服务'],
  ['server/configuration', '配置', '模拟服务'],
  ['server/monitor', '数据监控', '模拟服务'],
  ['gateway/overview', '运行总览', '采集网关'],
  ['gateway/nodes', '节点监控', '采集网关'],
  ['gateway/connections', '连接配置', '采集网关'],
  ['gateway/settings', '网关设置', '采集网关'],
];
function currentRoute() {
  const value = location.hash.slice(1);
  // Preserve bookmarks to the original node monitoring page.
  if (value === 'server') return 'server/monitor';
  return pages.some(([path]) => path === value) ? value : 'overview';
}
const ServerPage = memo(Server),
  GatewayPage = memo(Gateway);
function Clock() {
  const now = useClock();
  return (
    <time>{new Date(now).toLocaleString('zh-CN', { hour12: false })}</time>
  );
}
export default function App() {
  const [route, setRoute] = useState(currentRoute),
    [gatewaySummary, setGatewaySummary] = useState(null);
  useEffect(() => {
    const listener = () => setRoute(currentRoute());
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  const server = route.startsWith('server/'),
    current = pages.find(([path]) => path === route);
  const navigate = useCallback((path) => {
    location.hash = path;
  }, []);
  return (
    <>
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span className="brand-mark">↗</span>
          <span>
            OPC Console<small>设备与采集管理平台</small>
          </span>
        </a>
        <nav className="main-nav" aria-label="主导航">
          <a
            className={`nav-item nav-root ${route === 'overview' ? 'active' : ''}`}
            href="#overview"
            aria-current={route === 'overview' ? 'page' : undefined}
          >
            系统总览
          </a>
          {['模拟服务', '采集网关'].map((group) => (
            <section className="nav-group" aria-label={group} key={group}>
              <h2
                className={`nav-group-title ${current[2] === group ? 'current' : ''}`}
              >
                {group}
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
                      {title}
                    </a>
                  ))}
              </div>
            </section>
          ))}
        </nav>
        <div className="side-note">
          OPC UA → Kafka
          <p>
            模拟、采集与运维
            <br />
            在同一个工作空间中完成。
          </p>
          <small>独立 React 控制台</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            {current[2]} / {current[1]}
          </span>
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
          <div hidden={!route.startsWith('gateway/')}>
            <GatewayPage
              active={route.startsWith('gateway/')}
              observe={route === 'overview'}
              onStatus={setGatewaySummary}
              page={
                route.startsWith('gateway/') ? route.split('/')[1] : 'overview'
              }
              navigate={navigate}
            />
          </div>
        </main>
      </div>
    </>
  );
}
