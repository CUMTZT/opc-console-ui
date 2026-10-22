import { useEffect, useMemo, useRef, useState } from 'react';
import Simulation from './Simulation.jsx';
import ServerOverview from './features/server-overview/ServerOverview.jsx';
import Icon from './components/Icon.jsx';
import {
  Alert,
  Badge,
  Field,
  Metric,
  Modal,
  download,
  errorText,
  isCancelled,
  number,
  request,
  time,
  useClock,
  usePolling,
  useVisible,
} from './shared.jsx';

const types = ['FLOAT', 'LONG', 'BYTE', 'Bit'];
const quality = (node) =>
  node.statusCode >>> 30 === 0
    ? 'good'
    : node.statusCode >>> 30 === 1
      ? 'warn'
      : 'bad';
const hints = {
  FLOAT: 'Double 数值；模拟关闭时支持 NaN、+Inf、-Inf',
  LONG: 'Int32 整数：-2147483648～2147483647',
  BYTE: 'Byte 整数：0～255',
  Bit: 'Boolean：true / false，或 1 / 0',
};

function NodeEditor({ node, persistent, onClose, onSaved, onBusy }) {
  const [draft, setDraft] = useState({
    id: node?.id ?? '',
    name: node?.name ?? '',
    type: node?.type ?? 'FLOAT',
    value: node?.value ?? '0',
    write: !node,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function field(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  const needsValue = !node || draft.write || draft.type !== node.type;
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (
      !node &&
      (!/^\d+$/.test(String(draft.id)) || Number(draft.id) > 4294967295)
    ) {
      setError('节点 ID 必须为 0～4294967295 的整数');
      return;
    }
    setBusy(true);
    onBusy(true);
    setError('');
    const body = {
      name: draft.name,
      type: draft.type,
      ...(needsValue ? { value: draft.value } : {}),
      ...(node ? { revision: node.revision } : { id: Number(draft.id) }),
    };
    try {
      const savedNode = await request(
        `/api/server/nodes${node ? '/' + node.id : ''}`,
        {
          method: node ? 'PATCH' : 'POST',
          body,
        },
      );
      onSaved(
        node ? '节点已更新' : '节点已创建',
        savedNode,
        !node,
        !node || draft.name !== node.name || draft.type !== node.type,
      );
      onClose();
    } catch (e) {
      setError(
        errorText(e) +
          (e.status === 409
            ? '。当前输入已保留，请关闭后重新打开最新节点。'
            : ''),
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <Modal title={node ? '编辑节点' : '新增节点'} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <p>
          修改立即作用于真实 OPC UA 地址空间。
          {persistent
            ? '保存到状态文件，重启后恢复。'
            : '当前为内存模式，重启后失效。'}
        </p>
        <Alert>{error}</Alert>
        <fieldset disabled={busy}>
          <Field label="节点 ID" hint="Namespace 固定为 1，创建后不可更改">
            <input
              required
              inputMode="numeric"
              value={draft.id}
              disabled={!!node}
              onChange={(e) => field('id', e.target.value)}
            />
          </Field>
          <Field label="节点名称">
            <input
              required
              maxLength="256"
              value={draft.name}
              onChange={(e) => field('name', e.target.value)}
            />
          </Field>
          <Field label="数据类型">
            <select
              value={draft.type}
              onChange={(e) => field('type', e.target.value)}
            >
              {types.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </Field>
          {node && (
            <label className="check">
              <input
                type="checkbox"
                checked={draft.write || draft.type !== node.type}
                disabled={draft.type !== node.type}
                onChange={(e) => field('write', e.target.checked)}
              />
              同时修改当前值
            </label>
          )}
          <Field label={node ? '当前值' : '初始值'} hint={hints[draft.type]}>
            <input
              required={needsValue}
              disabled={!needsValue}
              value={draft.value}
              onChange={(e) => field('value', e.target.value)}
            />
          </Field>
        </fieldset>
        <div className="form-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? '正在保存…' : node ? '保存修改' : '创建节点'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteNode({ node, onClose, onSaved, onBusy }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function remove() {
    setBusy(true);
    onBusy(true);
    try {
      await request(`/api/server/nodes/${node.id}?revision=${node.revision}`, {
        method: 'DELETE',
      });
      onSaved('节点已删除', null, false, true);
      onClose();
    } catch (e) {
      setError(
        errorText(e) +
          (e.status === 409 ? '。节点版本已变化，请重新读取后删除。' : ''),
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <Modal title="删除节点" busy={busy} onClose={onClose}>
      <p>确认删除以下节点？现有 OPC UA 客户端随后读取该节点将返回不存在。</p>
      <strong>{node.name}</strong>
      <p className="mono">{node.nodeId}</p>
      <Alert>{error}</Alert>
      <div className="form-actions">
        <button className="button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button className="button danger" disabled={busy} onClick={remove}>
          确认删除
        </button>
      </div>
    </Modal>
  );
}

export default function Server({ active, page, navigate }) {
  const [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState(''),
    [paused, setPaused] = useState(false),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(''),
    [type, setType] = useState('all'),
    [qualityFilter, setQuality] = useState('all'),
    [descending, setDescending] = useState(false);
  const [detail, setDetail] = useState(null),
    [editor, setEditor] = useState(undefined),
    [deleting, setDeleting] = useState(null),
    [configurationVisited, setConfigurationVisited] = useState(
      page === 'configuration',
    ),
    [notice, setNotice] = useState('');
  const baseline = useRef(null),
    changed = useRef(new Set()),
    highlighted = useRef(new Map());
  const visible = useVisible();
  const now = useClock(active && visible && page !== 'configuration');
  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => {
    if (page === 'configuration') setConfigurationVisited(true);
  }, [page]);
  useEffect(() => {
    setPageIndex(0);
  }, [search, type, qualityFilter, descending]);
  async function read(signal) {
    try {
      const next = await request('/api/server/nodes', {
        signal,
        timeout: 8000,
      });
      const restarted = baseline.current?.startedAt !== next.startedAt;
      if (restarted) {
        changed.current.clear();
        highlighted.current.clear();
      }
      const previous = new Map(
        (restarted ? [] : baseline.current.nodes).map((node) => [
          node.id,
          node,
        ]),
      );
      for (const node of next.nodes) {
        const old = previous.get(node.id);
        if (
          old &&
          (node.value !== old.value || node.statusCode !== old.statusCode)
        ) {
          changed.current.add(node.id);
          highlighted.current.set(node.id, Date.now() + 2400);
        }
      }
      baseline.current = next;
      setSnapshot(next);
      setError('');
    } catch (e) {
      if (!isCancelled(e))
        setError(
          `无法读取模拟服务，保留最近一次成功同步的数据。${errorText(e)}`,
        );
    }
  }
  const refresh = usePolling(
    read,
    error || page === 'overview' ? 5000 : 1000,
    active &&
      visible &&
      page !== 'configuration' &&
      (page !== 'monitor' || !paused) &&
      !busy,
  );
  const nodes = snapshot?.nodes || [],
    query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      nodes
        .filter(
          (node) =>
            (!query ||
              (query.startsWith('ns=')
                ? node.nodeId.toLowerCase() === query
                : `${node.name} ${node.nodeId}`
                    .toLowerCase()
                    .includes(query))) &&
            (type === 'all' || node.type === type) &&
            (qualityFilter === 'all' || quality(node) === qualityFilter),
        )
        .sort((a, b) => (descending ? b.id - a.id : a.id - b.id)),
    [nodes, query, type, qualityFilter, descending],
  );
  const safePage = Math.min(
    pageIndex,
    Math.max(0, Math.ceil(filtered.length / 100) - 1),
  );
  const visibleNodes = filtered.slice(safePage * 100, safePage * 100 + 100);
  const good = nodes.filter((node) => quality(node) === 'good').length;
  const seconds = snapshot
    ? Math.max(
        0,
        Math.floor((now - new Date(snapshot.startedAt).getTime()) / 1000),
      )
    : 0;
  const currentDetail =
    detail === null ? null : nodes.find((node) => node.id === detail);
  function saved(message, node, created = false, catalogChanged = false) {
    if (created && node) {
      setSearch(node.nodeId);
      setType('all');
      setQuality('all');
    }
    setNotice(
      catalogChanged
        ? message + '。请到网关节点页重新发现，以更新目录与订阅。'
        : message,
    );
    refresh();
  }
  async function openEditor(node) {
    if (!node) {
      setEditor(null);
      return;
    }
    setBusy(true);
    try {
      setEditor(await request(`/api/server/nodes/${node.id}`));
      setDetail(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function exportCSV() {
    const cell = (value) =>
      '"' + String(value ?? '').replaceAll('"', '""') + '"';
    const rows = [
      [
        '采集时间',
        'NodeId',
        '节点名称',
        '类型',
        '当前值',
        '质量',
        '状态码',
        '源时间',
      ],
      ...filtered.map((node) => [
        snapshot.capturedAt,
        node.nodeId,
        node.name,
        node.type,
        node.value,
        node.quality,
        node.statusCode,
        node.sourceTimestamp,
      ]),
    ];
    download(
      'opc-nodes.csv',
      '\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n'),
      'text/csv;charset=utf-8',
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">OPC UA SIMULATOR</div>
          <h1>
            {{
              overview: '模拟服务总览',
              configuration: '配置',
              monitor: '数据监控',
            }[page] || '模拟服务'}
          </h1>
          <p>
            {
              {
                overview: '查看服务运行信息、节点规模与数据质量。',
                configuration: '配置节点动态值与按写入顺序触发的业务规则。',
                monitor: '监控实时节点值，筛选数据并管理地址空间。',
              }[page]
            }
          </p>
        </div>
        {page !== 'configuration' && (
          <div className="heading-actions">
            <Badge kind={error ? 'bad' : snapshot ? 'good' : ''}>
              {error ? '连接异常' : snapshot ? '已连接' : '正在连接'}
            </Badge>
            <button className="button" disabled={busy} onClick={refresh}>
              <Icon name="refresh" size={14} />
              立即刷新
            </button>
            {page === 'monitor' && (
              <>
                <button
                  className="button"
                  disabled={!snapshot}
                  onClick={exportCSV}
                >
                  <Icon name="download" size={14} />
                  导出 CSV
                </button>
                <button
                  className="button primary"
                  disabled={!snapshot || busy}
                  onClick={() => openEditor(null)}
                >
                  <Icon name="plus" size={15} />
                  新增节点
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {page !== 'configuration' && <Alert>{error}</Alert>}
      {notice && (
        <Alert kind="success">
          {notice}
          <button className="button small" onClick={() => setNotice('')}>
            关闭提示
          </button>
        </Alert>
      )}
      {page !== 'configuration' && (
        <section
          className={`metrics ${page === 'monitor' ? 'compact-metrics' : ''}`}
        >
          <Metric
            icon="database"
            label="节点总数"
            value={snapshot ? number(nodes.length) : '—'}
            hint="全部已注册变量"
          />
          <Metric
            icon="check"
            kind={snapshot && good === nodes.length ? 'good' : ''}
            label="质量正常"
            value={snapshot ? number(good) : '—'}
            hint={
              nodes.length
                ? `${((good / nodes.length) * 100).toFixed(1)}% 节点正常`
                : '等待节点数据'
            }
          />
          <Metric
            icon="activity"
            label="发生变化的节点"
            value={number(changed.current.size)}
            hint="本次浏览期间累计，重启后重置"
          />
          <Metric
            icon="clock"
            label="服务运行时间"
            value={
              snapshot
                ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`
                : '—'
            }
            hint={snapshot ? time(snapshot.startedAt) : '等待服务信息'}
          />
        </section>
      )}
      {page === 'overview' && (
        <ServerOverview snapshot={snapshot} nodes={nodes} navigate={navigate} />
      )}
      {configurationVisited && (
        <div hidden={page !== 'configuration'}>
          <Simulation
            active={active && page === 'configuration'}
            onSaved={() => saved('模拟配置已保存并应用')}
          />
        </div>
      )}
      {page === 'monitor' && (
        <section className="panel">
          <div className="panel-heading">
            <h2>
              实时节点数据 <Badge>{filtered.length}</Badge>
            </h2>
            <span className={`sync-state ${paused ? 'is-paused' : ''}`}>
              {paused ? '已暂停' : '每 1 秒自动刷新'}
            </span>
          </div>
          <div className="toolbar">
            <div className="search-field">
              <Icon name="search" size={16} />
              <input
                type="search"
                aria-label="搜索节点名称或 NodeId"
                placeholder="搜索节点名称或 NodeId…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="actions">
              <select
                aria-label="按质量筛选"
                value={qualityFilter}
                onChange={(e) => setQuality(e.target.value)}
              >
                <option value="all">全部质量</option>
                <option value="good">Good · 正常</option>
                <option value="warn">Uncertain · 不确定</option>
                <option value="bad">Bad · 异常</option>
              </select>
              <button
                className="button"
                onClick={() => setPaused((value) => !value)}
              >
                <Icon name={paused ? 'play' : 'pause'} size={13} />
                {paused ? '继续刷新' : '暂停刷新'}
              </button>
            </div>
          </div>
          <div className="type-tabs">
            {['all', ...types].map((value) => (
              <button
                key={value}
                className={`button small ${type === value ? 'selected' : ''}`}
                aria-pressed={type === value}
                onClick={() => setType(value)}
              >
                {value === 'all' ? '全部节点' : value}{' '}
                <span className="filter-count">
                  {
                    nodes.filter(
                      (node) => value === 'all' || node.type === value,
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
          <div
            className="table-scroll data-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="模拟节点数据表"
          >
            <table>
              <thead>
                <tr>
                  <th>序号</th>
                  <th>
                    <button
                      className="link"
                      onClick={() => setDescending((value) => !value)}
                    >
                      NODE ID {descending ? '↓' : '↑'}
                    </button>
                  </th>
                  <th>节点名称</th>
                  <th>类型</th>
                  <th>当前值</th>
                  <th>质量</th>
                  <th>源时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleNodes.map((node, index) => (
                  <tr
                    key={node.id}
                    className={
                      highlighted.current.get(node.id) > now ? 'changed' : ''
                    }
                  >
                    <td>{safePage * 100 + index + 1}</td>
                    <td className="mono">{node.nodeId}</td>
                    <td>{node.name}</td>
                    <td>
                      <Badge>{node.type}</Badge>
                    </td>
                    <td className="value">{node.value}</td>
                    <td>
                      <Badge kind={quality(node)}>{node.quality}</Badge>
                    </td>
                    <td className="mono">{time(node.sourceTimestamp)}</td>
                    <td>
                      <div className="actions row-actions">
                        <button
                          className="button small"
                          onClick={() => setDetail(node.id)}
                        >
                          详情
                        </button>
                        <button
                          className="button small"
                          disabled={busy}
                          onClick={() => openEditor(node)}
                        >
                          编辑
                        </button>
                        <button
                          className="button small text-danger"
                          disabled={busy}
                          onClick={() => setDeleting(node)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <div className="empty">
                {snapshot ? '没有匹配节点' : '正在读取节点…'}
                {snapshot && (
                  <button
                    className="button"
                    onClick={() => {
                      setSearch('');
                      setType('all');
                      setQuality('all');
                    }}
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="table-footer">
            <span>
              显示 {filtered.length} / {nodes.length} 个节点
            </span>
            <div className="actions">
              <button
                className="button small"
                disabled={safePage === 0}
                onClick={() => setPageIndex(safePage - 1)}
              >
                上一页
              </button>
              <span>
                {safePage + 1} / {Math.max(1, Math.ceil(filtered.length / 100))}
              </span>
              <button
                className="button small"
                disabled={(safePage + 1) * 100 >= filtered.length}
                onClick={() => setPageIndex(safePage + 1)}
              >
                下一页
              </button>
            </div>
            <span>最近同步 {time(snapshot?.capturedAt)}</span>
          </div>
        </section>
      )}
      {page !== 'configuration' && (
        <footer className="page-footer">
          <span>{snapshot?.endpoint || 'OPC UA 模拟服务'}</span>
          <span>
            {snapshot
              ? snapshot.persistent
                ? '管理变更保存到状态文件，运行值不逐次落盘'
                : '内存模式：重启后管理变更失效'
              : '等待保存方式'}
          </span>
        </footer>
      )}
      {active && page === 'monitor' && currentDetail && (
        <Modal title="节点详情" onClose={() => setDetail(null)}>
          <strong>{currentDetail.name}</strong>
          <div className="detail-value">{currentDetail.value}</div>
          <div className="actions">
            <button
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(currentDetail.value);
                  setNotice('已复制当前值');
                } catch {
                  setNotice('复制不可用，请手动选择当前值。');
                }
              }}
            >
              复制当前值
            </button>
            <button
              className="button"
              onClick={() => openEditor(currentDetail)}
            >
              编辑节点
            </button>
            <button
              className="button"
              onClick={() => {
                setDeleting(currentDetail);
                setDetail(null);
              }}
            >
              删除节点
            </button>
          </div>
          <dl>
            {[
              ['NodeId', currentDetail.nodeId],
              ['数据类型', `${currentDetail.type} / ${currentDetail.dataType}`],
              ['质量', currentDetail.quality],
              ['状态码', currentDetail.statusCode],
              ['源时间', time(currentDetail.sourceTimestamp)],
              ['版本', currentDetail.revision],
            ].map(([label, value]) => (
              <div key={label} className="detail-row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
      {active && page === 'monitor' && editor !== undefined && (
        <NodeEditor
          node={editor}
          persistent={snapshot?.persistent}
          onClose={() => setEditor(undefined)}
          onSaved={saved}
          onBusy={setBusy}
        />
      )}
      {active && page === 'monitor' && deleting && (
        <DeleteNode
          node={deleting}
          onClose={() => setDeleting(null)}
          onSaved={saved}
          onBusy={setBusy}
        />
      )}
    </>
  );
}
