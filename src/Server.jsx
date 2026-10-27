/**
 * 模拟服务容器：拥有节点快照、筛选分页及弹窗状态，按 page 展示总览/配置/监控。
 * NodeEditor、DeleteNode 是本文件内的小组件；Simulation 负责更复杂的方案编辑。
 * 后端快照与用户草稿分开保存，轮询读取只更新快照，不替换已经打开的编辑表单。
 */
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

// 模拟服务支持的四种 OPC UA 业务数据类型，用于类型筛选标签与节点编辑下拉框。
const types = ['FLOAT', 'LONG', 'BYTE', 'Bit'];
// OPC UA 状态码最高两位表示质量等级；>>> 是 JavaScript 的无符号右移运算。
const quality = (node) =>
  node.statusCode >>> 30 === 0
    ? 'good'
    : node.statusCode >>> 30 === 1
      ? 'warn'
      : 'bad';
// 各数据类型在节点新增/编辑表单中的输入格式与取值范围说明。
const hints = {
  FLOAT: 'Double 数值；模拟关闭时支持 NaN、+Inf、-Inf',
  LONG: 'Int32 整数：-2147483648～2147483647',
  BYTE: 'Byte 整数：0～255',
  Bit: 'Boolean：true / false，或 1 / 0',
};

/**
 * 节点编辑弹窗的输入契约：node=null 表示新增，否则包含节点 ID、值和 revision。
 * persistent 仅展示保存方式；onSaved 通知父级刷新，onClose 通知父级卸载弹窗。
 * onBusy 将提交忙碌状态向上汇报，父级据此暂停轮询与其他编辑按钮。
 */
function NodeEditor({ node, persistent, onClose, onSaved, onBusy }) {
  // node 为空表示新增，否则以打开弹窗时的节点初始化本地草稿。
  // value 保留字符串，避免浏览器提前转换而损失精度，也便于表达特殊浮点值。
  const [draft, setDraft] = useState({
    id: node?.id ?? '',
    name: node?.name ?? '',
    type: node?.type ?? 'FLOAT',
    value: node?.value ?? '0',
    // 新节点必须有初始值；编辑现有节点默认只改元信息，勾选后才同时改当前值。
    write: !node,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function field(key, value) {
    // 对象展开复制旧字段，[key] 是动态属性名；返回新对象通知 React 状态已变化。
    setDraft((current) => ({ ...current, [key]: value }));
  }
  // 改变类型时旧值可能已不适用，因此即便未主动勾选 write，也必须提交一个新类型的值。
  const needsValue = !node || draft.write || draft.type !== node.type;
  async function submit(event) {
    // 表单默认会提交并刷新文档；在 React 中阻止它，改由异步 API 保存。
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
      // 不需要写当前值时连 value 字段也不发送，防止表单里的旧值覆盖正在运行的值。
      ...(needsValue ? { value: draft.value } : {}),
      ...(node ? { revision: node.revision } : { id: Number(draft.id) }),
    };
    // 编辑必须携带打开时的 revision，后端才能拒绝基于过期数据的覆盖。
    try {
      const savedNode = await request(
        `/api/server/nodes${node ? '/' + node.id : ''}`,
        {
          method: node ? 'PATCH' : 'POST',
          body,
        },
      );
      // 位置参数依次是提示文本、保存结果、是否新增、目录元信息是否发生变化。
      // 父级只有在目录变化时提示去网关重新发现；普通值变化无需重建目录。
      onSaved(
        node ? '节点已更新' : '节点已创建',
        savedNode,
        !node,
        !node || draft.name !== node.name || draft.type !== node.type,
      );
      onClose();
    } catch (e) {
      // 冲突时只更新错误提示，不清空 draft，也不自动改用新 revision 再次保存。
      setError(
        errorText(e) +
          (e.status === 409
            ? '。当前输入已保留，请关闭后重新打开最新节点。'
            : ''),
      );
    } finally {
      // 成功和失败都解除忙碌状态；onBusy 把状态通知父组件，暂停节点自动刷新。
      setBusy(false);
      onBusy(false);
    }
  }
  // value/checked + onChange 构成受控表单：输入内容始终由 draft 决定。
  // type=button 的“取消”不会触发 submit，默认类型的保存按钮则会提交当前 form。
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

/** 删除确认只保存本弹窗的 busy/error；目标节点由父级决定，版本仍以打开时的快照为准。 */
function DeleteNode({ node, onClose, onSaved, onBusy }) {
  // 删除也使用 revision；确认时版本已变化就交给用户重新读取，避免删掉别人的修改。
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

/**
 * props：active 表示当前是否属于本服务页面，page 是 overview/configuration/monitor，
 * navigate 接收完整 Hash 路径，在总览快捷按钮中交给 App 执行导航。
 * snapshot：最近一次成功的节点快照；读取失败只更新 error，仍可展示最后成功的数据。
 * paused：仅控制监控页自动刷新；busy：请求提交/读取编辑数据期间的交互锁。
 * search/type/qualityFilter/descending：纯 UI 查询条件，不会修改后端目录。
 * detail：详情节点 ID；editor：undefined=关闭、null=新增、对象=编辑；deleting：待删节点。
 * configurationVisited：配置编辑器是否曾挂载；notice：保存成功等非错误提示。
 */
export default function Server({ active, page, navigate }) {
  // 第一组是服务数据和请求状态；第二组是查询条件；后续 state 控制详情/编辑/删除。
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
  // baseline 保存上一次成功快照；changed 是本会话发生过变化的 ID 集合，Set 自动去重。
  // highlighted 是 ID→高亮结束时间的 Map，与变化累计数分开，显示高亮只持续约 2.4 秒。
  const baseline = useRef(null),
    changed = useRef(new Set()),
    highlighted = useRef(new Map());
  // ref 存放跨请求的比较基线、累计变化节点及高亮截止时间，不单独触发 React 渲染。
  const visible = useVisible();
  // now 更新时让高亮到期和服务运行时间重算；配置页不需要这份本地秒钟。
  const now = useClock(active && visible && page !== 'configuration');
  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => {
    // 配置编辑器首次访问才挂载，以后仅隐藏；这样既延迟初始化，又保留未保存草稿。
    if (page === 'configuration') setConfigurationVisited(true);
  }, [page]);
  useEffect(() => {
    // 查询条件变化时回到第一页，防止仍停留在旧查询的较大页码而看到空表。
    setPageIndex(0);
  }, [search, type, qualityFilter, descending]);
  /** 拉取模拟服务全量节点快照，对比上次基线识别数值/质量变化并维护 2.4 秒闪烁高亮。 */
  async function read(signal) {
    try {
      const next = await request('/api/server/nodes', {
        signal,
        timeout: 8000,
      });
      // 首次 baseline 为 null 也视作新实例；下面 previous 用空数组，不会访问 null.nodes。
      const restarted = baseline.current?.startedAt !== next.startedAt;
      // 用启动时间区分服务实例；重启后不能把新实例和旧实例的值作为连续变化比较。
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
      // Map 按 ID 查找旧节点，避免对每个新节点再遍历一次整个旧数组。
      for (const node of next.nodes) {
        const old = previous.get(node.id);
        if (
          old &&
          (node.value !== old.value || node.statusCode !== old.statusCode)
        ) {
          // 本轮至少发生值或质量变化才计入；集合中的旧 ID 不重复累计。
          changed.current.add(node.id);
          highlighted.current.set(node.id, Date.now() + 2400);
        }
      }
      baseline.current = next;
      // ref 更新本身不重渲染，这次 setSnapshot 会让界面读到最新的变化统计。
      setSnapshot(next);
      setError('');
    } catch (e) {
      if (!isCancelled(e))
        setError(
          `无法读取模拟服务，保留最近一次成功同步的数据。${errorText(e)}`,
        );
    }
  }
  // 总览 5 秒、监控正常时 1 秒、失败后 5 秒；这些是请求完成后的等待时间。
  // 离开服务、标签页隐藏、编辑忙碌或暂停监控时，enabled=false 会清理当前轮询。
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
  // filtered 是已有状态推导的结果，不再放进 useState，避免维护两份可能不一致的数据。
  // useMemo 仅缓存计算；filter 先生成新数组，所以后面的 sort 不会修改原始 nodes。
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
  // 数据减少可能让旧 pageIndex 越界；safePage 夹到有效范围，且空列表仍保留第一页。
  const safePage = Math.min(
    pageIndex,
    Math.max(0, Math.ceil(filtered.length / 100) - 1),
  );
  // 模拟服务返回全量目录，前端再做筛选和每页 100 条展示；与网关的后端分页不同。
  const visibleNodes = filtered.slice(safePage * 100, safePage * 100 + 100);
  const good = nodes.filter((node) => quality(node) === 'good').length;
  const seconds = snapshot
    ? Math.max(
        0,
        Math.floor((now - new Date(snapshot.startedAt).getTime()) / 1000),
      )
    : 0;
  // 详情按 ID 查最新快照，显示值可继续更新；不会用详情快照反向替换编辑草稿。
  const currentDetail =
    detail === null ? null : nodes.find((node) => node.id === detail);
  /** 节点或模拟方案保存成功后的统一回调：定位新建节点、提示网关重发现并立即刷新快照。 */
  function saved(message, node, created = false, catalogChanged = false) {
    // 子组件通过回调上报保存结果；创建后用 NodeId 定位新节点，再主动同步服务快照。
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
  /** 打开节点编辑弹窗：新增时直接打开空白表单，编辑时先拉取单节点最新数据与 revision。 */
  async function openEditor(node) {
    // 编辑前单独读取最新节点及 revision；新增用 null，关闭用 undefined，区分三种状态。
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
  /** 将当前筛选条件下的全部模拟节点导出为带 UTF-8 BOM 的 CSV 文件。 */
  function exportCSV() {
    // 导出当前筛选的全部结果，而不是仅导出当前页；双引号转义是 CSV 格式要求。
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
    // UTF-8 BOM 帮助常见表格软件识别中文；每个字段加引号，字段中的引号用双引号转义。
    download(
      'opc-nodes.csv',
      '\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n'),
      'text/csv;charset=utf-8',
    );
  }
  // 页面主体按 page 条件渲染；行 key 使用稳定 node.id，排序和翻页不会混淆节点身份。
  // 详情只存 ID，再从最新快照查找，所以详情值可随轮询更新；编辑草稿则保持独立。
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
      {/* 非配置页的连接错误与配置编辑器自己的保存错误分别展示，避免不同操作的提示混在一起。 */}
      {page !== 'configuration' && <Alert>{error}</Alert>}
      {notice && (
        <Alert kind="success">
          {notice}
          <button className="button small" onClick={() => setNotice('')}>
            关闭提示
          </button>
        </Alert>
      )}
      {/* 指标由同一份快照推导；不要为节点总数、正常数再维护额外 state。 */}
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
      {/* 总览组件只接收数据与导航回调，不再自行下载一份相同的节点目录。 */}
      {page === 'overview' && (
        <ServerOverview snapshot={snapshot} nodes={nodes} navigate={navigate} />
      )}
      {/* 访问过一次以后保持编辑器实例；外层隐藏保留 draft，active 则停止无关运行态轮询。 */}
      {configurationVisited && (
        <div hidden={page !== 'configuration'}>
          <Simulation
            active={active && page === 'configuration'}
            onSaved={() => saved('模拟配置已保存并应用')}
          />
        </div>
      )}
      {/* 监控工具栏只更新 UI 状态；筛选结果和分页范围会在下一次渲染时重新计算。 */}
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
                {/* key 用稳定节点 ID；翻页序号仅用于显示，不用于识别节点身份。 */}
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
      {/* 用条件渲染挂载弹窗：条件变为 false 时 Modal 卸载并清理原生 dialog。 */}
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
      {/* 显式判断 undefined 才能让 null 的“新增模式”也渲染；不能写 editor && ...。 */}
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
