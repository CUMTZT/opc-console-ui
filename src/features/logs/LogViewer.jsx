/**
 * 两个服务共用的日志页面：service 选择接口前缀和响应拆包方式，active 控制是否查询。
 * App 中存在两个独立实例，所以模拟服务与网关的筛选、页码等 state 互不干扰。
 * 重点学习：防抖搜索、带锚点的后端分页、请求取消，以及旧响应不能覆盖新筛选结果。
 */
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

// 页面固定每次最多展示 50 条；后端仍有自己的响应条数上限，不能假设返回整个日志缓存。
const limit = 50;
// 日志级别到 Badge 样式变体的映射：ERROR 用红色告警，WARN 用黄色提醒，INFO/DEBUG 保持中性色。
const levelKinds = { ERROR: 'bad', WARN: 'warn', INFO: '', DEBUG: '' };
/** 日志时间格式化：保留毫秒精度以区分同一秒内连续产生的日志，按浏览器本地时区展示。 */
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
/** 组装下拉筛选项：合并服务端返回的可用项与当前已选值，防止缓存滚动淘汰后当前选中项从列表中消失。 */
const optionsWithSelection = (items, selected) => [
  // 新结果中暂时没有当前选项时也保留它，避免受控 select 的显示与筛选状态不一致。
  ...new Set([...(items || []), ...(selected ? [selected] : [])]),
];

/**
 * service 固定为 server/gateway：决定 API 前缀、标题、机组筛选和响应拆包方式。
 * active 决定是否显示/查询；两个 service 的组件实例一直存在，因此保留各自筛选。
 * search/query：即时输入/防抖后关键词；level/component/machine：其他过滤维度。
 * range/from/to：时间模式及自定义本地时间；offset/auto：分页起点及自动刷新开关。
 * data：最后一次有效响应（附带 key）；error/loading：请求状态；detail/notice：详情与说明。
 * cursor/currentKey/lastManualPage：跨请求辅助信息，不单独触发 UI 渲染，因此放进 ref。
 */
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
  // anchor 固定本次翻页的日志上界；instanceId 区分服务重启；bounds 固定历史查询时间窗。
  const lastManualPage = useRef('');
  const visible = useVisible();
  useEffect(() => {
    // 搜索框即时更新 search，请求等 350ms 后再用 query，避免每个按键都请求后端。
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  // filterKey 不含分页，任一筛选变化都要丢弃旧游标；key 再加 offset 标识单个结果页。
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
  // ref 用于请求完成时读取最新 key；不同于 state，修改 ref 不需要额外触发渲染。
  const currentKey = useRef(key);
  currentKey.current = key;
  // 空起止时间允许开放区间；非空值必须能转换为日期，随后再校验起点不能晚于终点。
  const validTime = (value) => !value || Number.isFinite(Date.parse(value));
  const validation =
    range === 'custom' && (!validTime(from) || !validTime(to))
      ? '请选择有效的开始与结束时间'
      : range === 'custom' && from && to && Date.parse(from) > Date.parse(to)
        ? '开始时间不能晚于结束时间'
        : '';
  useEffect(() => {
    // 筛选改变后，旧锚点/旧时间范围不再适用，并且要从第一页开始。
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
      // async 函数持有发起时的 key，返回后与 ref 中最新 key 比较，避免慢响应污染新查询。
      const requestedKey = key;
      setLoading(true);
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      // 只发送有值的筛选项；URLSearchParams 负责中文/空格等编码，不手工拼接查询文本。
      for (const [name, value] of Object.entries({
        q: query,
        level,
        component,
        machine,
      }))
        if (value) params.set(name, value);
      const bounds =
        // 历史页沿用首页确定的时间窗，否则“最近 15 分钟”会随着翻页不断移动。
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
        // 新日志持续追加时仍沿用同一 anchor，避免 offset 分页跳过或重复已有条目。
        params.set('anchor', String(cursor.current.anchor));
      try {
        const response = await request(`/api/${service}/logs?${params}`, {
          signal,
          timeout: 10000,
        });
        const page = parseLogPage(gateway ? response?.data : response);
        // 两个服务响应格式不同，先拆包再校验；过时请求的结果直接丢弃。
        if (currentKey.current !== requestedKey) return;
        if (
          offset > 0 &&
          cursor.current.instanceId &&
          cursor.current.instanceId !== page.instanceId
        ) {
          // 进程重启后日志 ID 可能重用，旧 anchor 已失效，应回到新进程的最新日志。
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
          // 环形缓存淘汰旧日志后总数可能变小，自动修正到仍有效的最后一页。
          setOffset(Math.max(0, Math.floor((page.total - 1) / limit)) * limit);
          setNotice('部分较早日志已不在缓存中，已调整分页。');
          return;
        }
        // page 本身通过契约校验后才进入 state，key 是客户端附加的查询身份，不发回后端。
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
        // 只结束仍属于当前查询且未取消的 loading；旧请求不能结束新请求的加载指示。
        if (currentKey.current === requestedKey && !signal.aborted)
          setLoading(false);
      }
    },
    // 出错后延长等待时间；历史页不自动滚动刷新，避免用户阅读位置不断变化。
    error ? 5000 : 2000,
    active && visible && auto && offset === 0 && !validation,
    key,
  );
  const manualPageKey = JSON.stringify([key, active, visible, validation]);
  useEffect(() => {
    // 历史页和暂停模式不自动轮询，但换页/重新激活后仍要读一次；ref 避免重复触发。
    if (lastManualPage.current === manualPageKey) return;
    lastManualPage.current = manualPageKey;
    if (active && visible && (!auto || offset > 0) && !validation) refresh();
  }, [manualPageKey, active, visible, auto, offset, validation]);
  useEffect(() => {
    if (!active) setDetail(null);
  }, [active]);
  // 即使 data 保留最后一次结果，也只展示与当前 key 匹配的页，防止筛选切换时冒充新结果。
  const page = data?.key === key ? data : null;
  /** 主动返回第一页最新日志：释放历史分页锚点 anchor，让下一轮请求重新以最新日志为上界。 */
  function latest() {
    // 主动回到最新页时释放旧锚点，让下一次响应建立新的日志上界。
    cursor.current.anchor = 0;
    setOffset(0);
    refresh();
  }
  /** 重置当前日志查看器实例的全部搜索、级别、模块、机组与时间筛选条件。 */
  function clear() {
    // 清筛选只改当前日志实例的 UI 状态，不会清除后端日志或修改服务记录级别。
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
  // 表格 key 同时包含进程实例和日志 ID；详情、导出都只针对已读入的当前查询数据。
  // {entry.message} 以普通文本渲染，不能改成 dangerouslySetInnerHTML 执行日志内容。
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
      {/* 查询区的所有输入均为受控状态；调整条件触发新的 key，随后由 Hook 建立新请求。 */}
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
        {/* datetime-local 没有自带时区，组装请求时才转为 ISO UTC；不能把原文本直接当 UTC。 */}
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
              {/* 单进程日志 ID 可能在重启后重用，所以同时把 instanceId 纳入 key。 */}
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
        {/* offset 是零起点记录数，显示区间才加 1；按钮按实际 total 决定还能否翻页。 */}
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
      {/* 详情直接展示日志文本和已验证的字符串字段，React 文本插值不会执行其中的 HTML。 */}
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
