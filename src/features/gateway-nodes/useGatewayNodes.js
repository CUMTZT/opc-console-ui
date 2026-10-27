/**
 * 设备节点自定义 Hook：把请求、查询状态和安全写入流程从 JSX 展示中提取出来。
 * 自动轮询读缓存；readDevice 主动读设备；write 只发送一次，随后 verify 读取当前值。
 * 返回普通对象供 GatewayNodes 渲染；调用此 Hook 的 Gateway 才是这些状态的拥有者。
 */
import { parseNodePage } from '../../api/contracts';
import { useEffect, useRef, useState } from 'react';
import {
  errorText,
  isCancelled,
  usePolling,
  useVisible,
} from '../../shared.jsx';

/**
 * api：Gateway 提供的已拆包请求函数；enabled：管理连接是否初始化成功。
 * active：节点页是否正在显示；machine：当前选择的运行机组编码。
 * allowWrite：父级根据网关只读/状态错误得到的基础权限，还要经过本 Hook 的新鲜度检查。
 * refreshStatus：重新发现启动后请求父级刷新，便于跟踪新会话与新快照状态。
 * 搜索/分页状态与请求结果在同一个 Hook 中，避免展示层遗漏重置与取消的配套步骤。
 */
export function useGatewayNodes({
  api,
  enabled,
  active,
  machine,
  allowWrite,
  refreshStatus,
}) {
  // search 是即时输入，query 是防抖后的请求条件，offset 是后端分页起点（每页 25 条）。
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [auto, setAuto] = useState(true);
  // target 固定写入对象；value 是用户输入；readback 是设备实际当前值，不能用 value 冒充。
  const [target, setTarget] = useState(null),
    [value, setValue] = useState(''),
    [phase, setPhase] = useState('idle'),
    [writeError, setWriteError] = useState(''),
    [readback, setReadback] = useState(null),
    [verification, setVerification] = useState(null);
  // phase：idle → writing → reading → confirmed；任何未确认结果进入 unknown。
  // verification 独立于弹窗 target 保存，所以关闭弹窗也不会丢掉待确认操作。
  // directBusy 是整页设备直读，scanBusy 是提交重新发现请求；scan 另行跟踪后台进度。
  const [directBusy, setDirectBusy] = useState(false),
    [scanBusy, setScanBusy] = useState(false),
    [scan, setScan] = useState(null),
    [operations, setOperations] = useState([]);
  const current = useRef({});
  // 异步结果返回时通过 ref 读取最新查询，避免旧闭包把 A 机组的数据写到 B 机组。
  current.current = {
    enabled,
    machine,
    key: JSON.stringify([machine, query, offset]),
  };
  const direct = useRef(null),
    visible = useVisible();
  // busy 聚合正在执行的互斥阶段；unknown 不算网络忙碌，但 verification 仍会禁止新写入。
  const busy =
    directBusy || scanBusy || phase === 'writing' || phase === 'reading';
  // 同一查询身份由三项决定，JSON 数组编码避免直接拼接字符串可能出现的分隔符冲突。
  const key = JSON.stringify([machine, query, offset]);
  useEffect(() => {
    // 每次输入都清除旧定时器；连续输入结束 350ms 后才实际改变查询条件。
    const timer = setTimeout(() => {
      // 输入停止后才真正改变 query，URL 请求使用 query，不直接使用每次按键的 search。
      setQuery(search.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setOffset(0);
  }, [machine]);
  useEffect(() => {
    direct.current?.abort();
    // 机组/筛选/页码变化时取消直读并清空旧页，界面不会把旧查询当作新查询结果。
    setDirectBusy(false);
    setPage(null);
    setError('');
  }, [machine, query, offset, enabled]);
  useEffect(() => {
    setSearch('');
    // 管理连接 enabled 变化才重置会话数据；普通子页面切换不会清空这些状态。
    setQuery('');
    setOffset(0);
    setTarget(null);
    setPhase('idle');
    setVerification(null);
    setWriteError('');
    setReadback(null);
    setScan(null);
    setOperations([]);
  }, [enabled]);
  // 这是返回清理函数的简写：卸载时取消正在等待的整页直读，不是挂载时立即执行 abort。
  useEffect(() => () => direct.current?.abort(), []);
  /** 在当前浏览器会话内存中记录最近 20 次设备写入、回读或重发现操作，供页面排错核对。 */
  function record(operation) {
    // 操作记录只是当前页面会话的最近 20 条，不能替代后端持久化审计记录。
    setOperations((items) =>
      [{ at: new Date().toISOString(), ...operation }, ...items].slice(0, 20),
    );
  }
  // 运行时契约校验是实际执行的函数，不是 TypeScript 类型断言；不合法响应不进入页面 state。
  const validPage = parseNodePage;
  const refreshCache = usePolling(
    async (signal) => {
      if (!enabled || !machine) return;
      try {
        const data = validPage(
          // URLSearchParams 负责转义；source=cache 不触发每次都读取现场设备。
          await api(
            `/nodes?${new URLSearchParams({ machine, search: query, offset: String(offset), limit: '25', source: 'cache' })}`,
            { signal },
          ),
        );
        // 给结果标记发起时的查询身份；底部 currentPage 只接纳与当前 key 一致的结果。
        setPage({ ...data, key });
        setError('');
      } catch (e) {
        if (!isCancelled(e) && current.current.enabled === enabled)
          setError(errorText(e));
      }
    },
    3000,
    // 打开写入弹窗或进行设备操作期间暂停缓存轮询，避免和写入回读争抢页面显示。
    active && visible && !!enabled && !!machine && !target && !busy && auto,
    key + enabled,
  );
  useEffect(() => {
    // 关闭自动刷新后，主动换页/换筛选仍需要取一次结果；手动刷新可绕过 enabled。
    if (active && enabled && machine && !auto) refreshCache();
  }, [key, active, enabled, auto]);
  /** 显式触发整页设备直读（source=device），独立管理取消控制器并校验返回时的查询身份。 */
  async function readDevice() {
    // 与缓存轮询分开使用 AbortController；慢响应还要校验 requestedKey 才能落入 state。
    if (!machine || directBusy) return;
    direct.current?.abort();
    const controller = new AbortController();
    direct.current = controller;
    // 捕获发起时的身份；await 返回后 key 可能已经变化，届时用 current ref 重新核对。
    const requestedKey = key;
    setDirectBusy(true);
    setError('');
    try {
      const data = validPage(
        await api(
          `/nodes?${new URLSearchParams({ machine, search: query, offset: String(offset), limit: '25', source: 'device' })}`,
          { signal: controller.signal },
        ),
      );
      if (current.current.key === requestedKey)
        setPage({ ...data, key: requestedKey });
    } catch (e) {
      if (!isCancelled(e)) setError(errorText(e));
    } finally {
      // 已有更新的直读请求接管时，旧 finally 不能把新请求的忙碌状态设为 false。
      if (direct.current === controller) setDirectBusy(false);
    }
  }
  /** 打开单节点安全写入弹窗：锁定目标机组、节点编码与写前值，初始化写入状态机为 idle。 */
  function openWrite(node) {
    // 弹窗固定目标机组和节点，后续回读以这个目标为准，不跟随界面选择悄悄变更。
    if (!canWrite || node.stale) return;
    // 将当时的 machine 复制进目标；后续操作和回读都用目标中的机组，不猜测界面当前值。
    setTarget({ ...node, machine });
    setValue(node.value);
    setPhase('idle');
    setWriteError('');
    setReadback(null);
  }
  /** 执行写后单点设备回读确认（GET /nodes/value），校验节点编码、观测时间与 Good 质量码。 */
  async function verify(operation) {
    // 回读是 GET；可在未知写入后再次执行。读到当前值不等于证明原写入已经成功。
    setPhase('reading');
    setWriteError('');
    try {
      const actual = await api(
        `/nodes/value?${new URLSearchParams({ machine: operation.machine, code: operation.code })}`,
      );
      // 单点回读必须拿到同一 code、真实观测时间和 Good 质量；HTTP 200 本身不够。
      if (
        !actual ||
        actual.code !== operation.code ||
        !actual.observedAt ||
        actual.quality >>> 30 !== 0
      )
        throw new Error('设备回读未得到质量正常的当前值，请重新读取确认');
      // writeAccepted 表示原写入是否获得接受响应；即使之后读到值也不能改写这一事实。
      setReadback({ ...actual, writeAccepted: !!operation.accepted });
      // 已得到有效当前值，可以解除“还需要回读”的锁；原请求未知仍在 readback/记录中说明。
      setVerification(null);
      setPhase('confirmed');
      setPage((previous) =>
        // 只更新仍在查看该机组的节点页，旧机组的回读不能覆盖当前机组数据。
        previous && current.current.machine === operation.machine
          ? {
              ...previous,
              nodes: previous.nodes.map((node) =>
                node.code === actual.code ? actual : node,
              ),
            }
          : previous,
      );
      record({
        kind: operation.accepted ? '设备写入回读' : '未知写入后的当前值读取',
        machine: operation.machine,
        code: operation.code,
        state: operation.accepted ? 'confirmed' : 'observed',
        operationId: operation.operationId,
        value: actual.value,
      });
      // 返回值描述本次回读是否成功；不是承诺 requested 与 actual.value 相等。
      return true;
    } catch (e) {
      if (!isCancelled(e) && current.current.enabled === enabled) {
        setPhase('unknown');
        // 回读失败继续保留待确认操作，禁止重新写入来“试试看”。
        setVerification(operation);
        setWriteError(errorText(e) + ' 写入不会自动重试，请重新回读确认。');
        record({
          kind: '写入结果待确认',
          machine: operation.machine,
          code: operation.code,
          state: 'unknown',
          operationId: operation.operationId,
        });
      }
      return false;
    }
  }
  /** 提交单节点设备写入指令（POST /nodes/write）：仅在 idle 状态发送一次，超时或异常时转入 unknown 待回读状态，严禁自动重试。 */
  async function write(event) {
    event.preventDefault();
    // 只有全新 idle 操作能提交；writing/reading/confirmed/unknown 都不会重复发 POST。
    if (!target || phase !== 'idle' || !canWrite) return;
    setPhase('writing');
    setWriteError('');
    // 先记录目标和请求值，再等待响应；没有 operationId 的超时也仍有足够上下文可回读。
    const operation = {
      machine: target.machine,
      code: target.code,
      requested: value,
    };
    setVerification(operation);
    try {
      // 一次用户提交对应一次 POST。超时只表示响应未知，设备可能已经执行，不能重发。
      const accepted = await api('/nodes/write', {
        method: 'POST',
        body: { machine: operation.machine, code: operation.code, value },
      });
      // operation 记录本次事件上下文，也已交给 verification 保存；这里补充后端响应编号。
      // 二者此时共用引用，后续 setPhase/setReadback 等更新会推动渲染，不能理解为赋值本身触发渲染。
      operation.operationId = accepted?.operationId;
      operation.accepted = true;
      // 已接受仍需回读当前值，弹窗在回读结束前保持忙碌，防止再次提交。
      record({ kind: '设备写入', ...operation, state: 'accepted' });
      await verify(operation);
    } catch (e) {
      if (!isCancelled(e) && current.current.enabled === enabled) {
        setPhase('unknown');
        setVerification(operation);
        setWriteError(errorText(e) + ' 操作结果需回读确认，不会自动重试。');
        record({
          kind: '设备写入',
          ...operation,
          state: 'unknown',
          requestId: e.requestId,
        });
      }
    }
  }
  /** 触发指定机组的节点目录重新发现（POST /nodes/rediscover），重建 OPC UA 会话并跟踪新代次快照状态。 */
  async function rediscover() {
    // 202/接受响应只是启动了后台重发现；updateScan 再结合状态轮询跟踪完成情况。
    if (!machine || scanBusy || busy) return;
    if (
      !window.confirm(
        '重新发现会重建该机组的 OPC UA 会话，并等待旧消息确认。确认继续？',
      )
    )
      return;
    setScanBusy(true);
    setScan({ state: 'starting', machine });
    setError('');
    try {
      const accepted = await api('/nodes/rediscover', {
        method: 'POST',
        body: { machine },
      });
      // 已接受后进入浏览等待，不能直接写 ready；后续状态轮询还要确认新代次与快照。
      setScan({ state: 'browsing', machine, generation: accepted.generation });
      setPage(null);
      record({ kind: '重新发现节点', machine, state: 'accepted' });
      refreshStatus();
      refreshCache();
    } catch (e) {
      setScan({ state: 'failed', machine, message: errorText(e) });
      setError(errorText(e));
    } finally {
      setScanBusy(false);
    }
  }
  /** 根据网关状态轮询结果推进节点重发现进度，区分目录已浏览（snapshot）与首个快照已确认（ready）。 */
  function updateScan(statuses) {
    // generation 防止误用旧会话结果；有新目录仍需区分 snapshot 等待与 ready 已确认。
    if (!scan || !['browsing', 'snapshot'].includes(scan.state)) return;
    const status = statuses.find((s) => s.code === scan.machine);
    if (
      // 使用代次而不只看 connected，防止把重建前的旧连接视为本次发现已完成。
      status?.generation >= scan.generation &&
      status.lastBrowseTime &&
      !status.lastBrowseTime.startsWith('0001-') &&
      status.nodeCount >= 0
    ) {
      setScan({
        ...scan,
        state: status.ready ? 'ready' : 'snapshot',
        count: status.nodeCount,
        stage: status.stage,
      });
      refreshCache();
    }
  }
  const currentPage = page?.key === key ? page : null;
  // 查询 key 再加一层展示校验；即使保留了旧数据，也不显示成当前查询的有效页。
  // 时间新鲜度取缓存生成/设备读回时间，不用不变化的源时间判断离线。
  const capturedAt = Date.parse(
    currentPage?.capturedAt || currentPage?.readAt || '',
  );
  const viewStale =
    !!error ||
    !!currentPage?.stale ||
    // 暂停超过 15 秒的视图限制写入；Date.now 仅在发生渲染时重算，不是独立超时器。
    (!auto &&
      (!Number.isFinite(capturedAt) || Date.now() - capturedAt > 15000));
  const canWrite =
    // 写入权限由只读状态、数据新鲜度、请求忙碌和上次操作是否待确认共同决定。
    allowWrite &&
    !!currentPage &&
    !viewStale &&
    !error &&
    !busy &&
    !verification;
  return {
    // UI 通过这些状态和事件函数工作，无需自行拼装接口或重复实现安全判断。
    search,
    setSearch,
    offset,
    setOffset,
    page: currentPage,
    error,
    auto,
    setAuto,
    refreshCache,
    readDevice,
    directBusy,
    busy,
    target,
    value,
    setValue,
    phase,
    writeError,
    readback,
    verification,
    canWrite,
    viewStale,
    openWrite,
    write,
    verify,
    // 关闭只清弹窗目标；若仍有待确认操作，verification 会留在页外提示中继续引导回读。
    closeWrite: () => {
      if (!busy) {
        setTarget(null);
        setPhase(verification ? 'unknown' : 'idle');
      }
    },
    scan,
    rediscover,
    updateScan,
    operations,
  };
}
