import { useEffect, useRef, useState } from 'react';
import { parseLogPage } from '../../api/contracts';
import Icon from '../../components/Icon.jsx';
import {
  Alert,
  Badge,
  Field,
  Modal,
  download,
  errorText,
  isCancelled,
  number,
  request,
  time,
  usePolling,
  useVisible,
} from '../../shared.jsx';

const limit = 50;
const levelKinds = { ERROR: 'bad', WARN: 'warn', INFO: '', DEBUG: '' };
const timestamp = (value) =>
  new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  });
const optionsWithSelection = (items, selected) => [
  ...new Set([...(items || []), ...(selected ? [selected] : [])]),
];

export default function LogViewer({ service, active }) {
  const gateway = service === 'gateway',
    title = gateway ? '采集网关' : '模拟服务';
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [level, setLevel] = useState(''),
    [component, setComponent] = useState(''),
    [machine, setMachine] = useState('');
  const [range, setRange] = useState('all'),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [offset, setOffset] = useState(0),
    [auto, setAuto] = useState(true);
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null),
    [notice, setNotice] = useState('');
  const cursor = useRef({ anchor: 0, instanceId: '', bounds: {} });
  const lastManualPage = useRef('');
  const visible = useVisible();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  const filterKey = JSON.stringify([
    service,
    query,
    level,
    component,
    machine,
    range,
    from,
    to,
  ]);
  const key = filterKey + ':' + offset;
  const currentKey = useRef(key);
  currentKey.current = key;
  const validTime = (value) => !value || Number.isFinite(Date.parse(value));
  const validation =
    range === 'custom' && (!validTime(from) || !validTime(to))
      ? '请选择有效的开始与结束时间'
      : range === 'custom' && from && to && Date.parse(from) > Date.parse(to)
        ? '开始时间不能晚于结束时间'
        : '';
  useEffect(() => {
    cursor.current.anchor = 0;
    cursor.current.bounds = {};
    setOffset(0);
    setError('');
    setNotice('');
    setLoading(false);
  }, [filterKey]);
  const refresh = usePolling(
    async (signal) => {
      if (!active || validation) return;
      const requestedKey = key;
      setLoading(true);
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      for (const [name, value] of Object.entries({
        q: query,
        level,
        component,
        machine,
      }))
        if (value) params.set(name, value);
      const bounds =
        offset > 0
          ? cursor.current.bounds
          : range === 'custom'
            ? {
                from: from ? new Date(from).toISOString() : '',
                to: to ? new Date(to).toISOString() : '',
              }
            : range === 'all'
              ? {}
              : { from: new Date(Date.now() - Number(range)).toISOString() };
      for (const [name, value] of Object.entries(bounds))
        if (value) params.set(name, value);
      if (offset > 0 && cursor.current.anchor)
        params.set('anchor', String(cursor.current.anchor));
      try {
        const response = await request(`/api/${service}/logs?${params}`, {
          signal,
          timeout: 10000,
        });
        const page = parseLogPage(gateway ? response?.data : response);
        if (currentKey.current !== requestedKey) return;
        if (
          offset > 0 &&
          cursor.current.instanceId &&
          cursor.current.instanceId !== page.instanceId
        ) {
          cursor.current = {
            anchor: 0,
            instanceId: page.instanceId,
            bounds: {},
          };
          setOffset(0);
          setNotice('服务已重新启动，已返回最新日志。');
          return;
        }
        cursor.current = {
          anchor: page.anchor,
          instanceId: page.instanceId,
          bounds,
        };
        if (offset > 0 && offset >= page.total) {
          setOffset(Math.max(0, Math.floor((page.total - 1) / limit)) * limit);
          setNotice('部分较早日志已不在缓存中，已调整分页。');
          return;
        }
        setData({ ...page, key: requestedKey });
        setError('');
      } catch (e) {
        if (!isCancelled(e) && currentKey.current === requestedKey)
          setError(
            e.status === 404
              ? '日志接口不可用，请更新并重启配套 Go 服务。'
              : '日志读取失败，保留最近一次成功查询。' + errorText(e),
          );
      } finally {
        if (currentKey.current === requestedKey && !signal.aborted)
          setLoading(false);
      }
    },
    error ? 5000 : 2000,
    active && visible && auto && offset === 0 && !validation,
    key,
  );
  const manualPageKey = JSON.stringify([key, active, visible, validation]);
  useEffect(() => {
    if (lastManualPage.current === manualPageKey) return;
    lastManualPage.current = manualPageKey;
    if (active && visible && (!auto || offset > 0) && !validation) refresh();
  }, [manualPageKey, active, visible, auto, offset, validation]);
  useEffect(() => {
    if (!active) setDetail(null);
  }, [active]);
  const page = data?.key === key ? data : null;
  function latest() {
    cursor.current.anchor = 0;
    setOffset(0);
    refresh();
  }
  function clear() {
    setSearch('');
    setQuery('');
    setLevel('');
    setComponent('');
    setMachine('');
    setRange('all');
    setFrom('');
    setTo('');
    setOffset(0);
    cursor.current.anchor = 0;
  }
  if (!active) return null;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {gateway ? 'GATEWAY LOGS' : 'SIMULATOR LOGS'}
          </div>
          <h1>运行日志</h1>
          <p>{title}当前进程日志，按级别、模块、时间与关键词定位运行问题。</p>
        </div>
        <div className="heading-actions">
          <Badge kind={error ? 'bad' : page ? 'good' : ''}>
            {error
              ? '查询异常'
              : loading
                ? '正在读取'
                : offset > 0
                  ? '历史分页'
                  : auto
                    ? '自动刷新'
                    : '已暂停'}
          </Badge>
          <button className="button" onClick={latest} disabled={!!validation}>
            <Icon name="refresh" size={14} />
            刷新日志
          </button>
          <button
            className="button"
            disabled={!page?.entries.length}
            onClick={() =>
              download(
                `opc-${service}-logs.json`,
                JSON.stringify(
                  {
                    ...page,
                    query: {
                      q: query,
                      level,
                      component,
                      machine,
                      range,
                      from,
                      to,
                    },
                  },
                  null,
                  2,
                ),
                'application/json',
              )
            }
          >
            <Icon name="download" size={14} />
            导出当前页
          </button>
        </div>
      </div>
      <Alert>{validation || error}</Alert>
      {notice && <Alert kind="info">{notice}</Alert>}
      <section className="panel log-panel">
        <div className="panel-heading">
          <h2>
            <Icon name="fileText" size={17} />
            {title}日志 <Badge>{page ? number(page.total) : '—'}</Badge>
          </h2>
          <span className="subtle">
            {page ? `最近同步 ${time(page.capturedAt)}` : '等待日志数据'}
          </span>
        </div>
        <div className="toolbar">
          <div className="search-field">
            <Icon name="search" size={16} />
            <input
              type="search"
              aria-label="搜索日志"
              placeholder="搜索日志内容、请求编号或字段…"
              maxLength={120}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="actions">
            <label className="check">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => setAuto(e.target.checked)}
              />
              自动刷新
            </label>
            <button className="button" onClick={clear}>
              清除筛选
            </button>
          </div>
        </div>
        <div className={`log-filters ${gateway ? 'with-machine' : ''}`}>
          <Field label="日志级别">
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">全部级别</option>
              <option value="DEBUG">DEBUG · 调试</option>
              <option value="INFO">INFO · 信息</option>
              <option value="WARN">WARN · 警告</option>
              <option value="ERROR">ERROR · 错误</option>
            </select>
          </Field>
          <Field label="日志模块">
            <select
              value={component}
              onChange={(e) => setComponent(e.target.value)}
            >
              <option value="">全部模块</option>
              {optionsWithSelection(
                page?.components || data?.components,
                component,
              ).map((item) => (
                <option key={item} value={item}>
                  {item === 'default' ? '未分类' : item}
                </option>
              ))}
            </select>
          </Field>
          {gateway && (
            <Field label="日志机组">
              <select
                value={machine}
                onChange={(e) => setMachine(e.target.value)}
              >
                <option value="">全部机组</option>
                {optionsWithSelection(
                  page?.machines || data?.machines,
                  machine,
                ).map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="日志时间范围">
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="all">全部缓存日志</option>
              <option value="900000">最近 15 分钟</option>
              <option value="3600000">最近 1 小时</option>
              <option value="86400000">最近 24 小时</option>
              <option value="custom">自定义时间</option>
            </select>
          </Field>
        </div>
        {range === 'custom' && (
          <div className="log-custom-time">
            <Field label="开始时间">
              <input
                type="datetime-local"
                step="1"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="结束时间">
              <input
                type="datetime-local"
                step="1"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
            <p>按浏览器本地时间查询，可单独指定开始或结束时间。</p>
          </div>
        )}
        <div className="log-query-summary">
          <span>
            {page
              ? `匹配 ${number(page.total)} 条 · 缓存 ${number(page.retained)} / ${number(page.capacity)} 条`
              : loading
                ? '正在查询…'
                : '尚无查询结果'}
          </span>
          <span>
            {offset > 0
              ? '浏览历史页时暂停自动刷新'
              : auto
                ? '每 2 秒刷新最新页'
                : '自动刷新已暂停'}
            {offset > 0 && (
              <button className="button link" onClick={latest}>
                查看最新日志
                <Icon name="arrowRight" size={13} />
              </button>
            )}
          </span>
        </div>
        <div
          className="table-scroll data-table-scroll log-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={`${title}日志数据表`}
        >
          <table className="log-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>级别</th>
                <th>模块{gateway ? ' / 机组' : ''}</th>
                <th>日志内容</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {page?.entries.map((entry) => (
                <tr key={`${page.instanceId}-${entry.id}`}>
                  <td className="mono log-time">{timestamp(entry.time)}</td>
                  <td>
                    <Badge kind={levelKinds[entry.level]}>{entry.level}</Badge>
                  </td>
                  <td>
                    <span className="mono">
                      {entry.component === 'default'
                        ? '未分类'
                        : entry.component}
                    </span>
                    {entry.machine && <small>{entry.machine}</small>}
                  </td>
                  <td className="log-message">
                    <span>{entry.message}</span>
                    {entry.requestId && (
                      <small className="mono">请求 {entry.requestId}</small>
                    )}
                    {entry.truncated && <small>单条日志内容已截断</small>}
                  </td>
                  <td>
                    <button
                      className="button small"
                      onClick={() => setDetail(entry)}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!page?.entries.length && (
            <div className="empty">
              {loading && !error
                ? '正在读取日志…'
                : error
                  ? '暂时无法读取日志，请检查服务连接。'
                  : '当前筛选条件下没有日志。'}
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            显示{' '}
            {page?.entries.length
              ? `${offset + 1}–${offset + page.entries.length}`
              : '0'}{' '}
            / {page?.total ?? 0} 条
          </span>
          <div className="actions">
            <button
              className="button small"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              上一页
            </button>
            <span>
              {Math.floor(offset / limit) + 1} /{' '}
              {Math.max(1, Math.ceil((page?.total || 0) / limit))}
            </span>
            <button
              className="button small"
              disabled={!page || offset + limit >= page.total || loading}
              onClick={() => setOffset(offset + limit)}
            >
              下一页
            </button>
          </div>
          <span>按接收顺序，最新日志优先</span>
        </div>
      </section>
      <p className="log-retention-note">
        <Icon name="info" size={14} />
        当前进程最多保留 {number(page?.capacity || data?.capacity || 3000)}{' '}
        条日志，文本预算{' '}
        {Math.round(
          (page?.byteBudget || data?.byteBudget || 8388608) / 1048576,
        )}{' '}
        MiB；重启后清空。
        {page?.discarded
          ? `已有 ${number(page.discarded)} 条较早或超限日志不在缓存中。`
          : ''}
        页面筛选不会改变服务端记录级别。
      </p>
      {active && detail && (
        <Modal title="日志详情" onClose={() => setDetail(null)}>
          <dl>
            <dt>服务</dt>
            <dd>{title}</dd>
            <dt>时间</dt>
            <dd>{timestamp(detail.time)}</dd>
            <dt>级别</dt>
            <dd>
              <Badge kind={levelKinds[detail.level]}>{detail.level}</Badge>
            </dd>
            <dt>模块</dt>
            <dd>{detail.component}</dd>
            {detail.machine && (
              <>
                <dt>机组</dt>
                <dd>{detail.machine}</dd>
              </>
            )}
            {detail.requestId && (
              <>
                <dt>请求编号</dt>
                <dd className="mono">{detail.requestId}</dd>
              </>
            )}
          </dl>
          <h3>日志内容{detail.truncated ? '（已截断）' : ''}</h3>
          <pre className="log-detail-message">{detail.message}</pre>
          <h3>结构化字段</h3>
          <dl>
            {Object.entries(detail.fields).map(([name, value]) => (
              <div className="detail-row" key={name}>
                <dt className="mono">{name}</dt>
                <dd className="mono">{value}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </>
  );
}
