import { parseNodePage } from '../../api/contracts';
import { useEffect, useRef, useState } from 'react';
import {
  errorText,
  isCancelled,
  usePolling,
  useVisible,
} from '../../shared.jsx';

export function useGatewayNodes({
  api,
  enabled,
  active,
  machine,
  allowWrite,
  refreshStatus,
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [auto, setAuto] = useState(true);
  const [target, setTarget] = useState(null),
    [value, setValue] = useState(''),
    [phase, setPhase] = useState('idle'),
    [writeError, setWriteError] = useState(''),
    [readback, setReadback] = useState(null),
    [verification, setVerification] = useState(null);
  const [directBusy, setDirectBusy] = useState(false),
    [scanBusy, setScanBusy] = useState(false),
    [scan, setScan] = useState(null),
    [operations, setOperations] = useState([]);
  const current = useRef({});
  current.current = {
    enabled,
    machine,
    key: JSON.stringify([machine, query, offset]),
  };
  const direct = useRef(null),
    visible = useVisible();
  const busy =
    directBusy || scanBusy || phase === 'writing' || phase === 'reading';
  const key = JSON.stringify([machine, query, offset]);
  useEffect(() => {
    const timer = setTimeout(() => {
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
    setDirectBusy(false);
    setPage(null);
    setError('');
  }, [machine, query, offset, enabled]);
  useEffect(() => {
    setSearch('');
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
  useEffect(() => () => direct.current?.abort(), []);
  function record(operation) {
    setOperations((items) =>
      [{ at: new Date().toISOString(), ...operation }, ...items].slice(0, 20),
    );
  }
  const validPage = parseNodePage;
  const refreshCache = usePolling(
    async (signal) => {
      if (!enabled || !machine) return;
      try {
        const data = validPage(
          await api(
            `/nodes?${new URLSearchParams({ machine, search: query, offset: String(offset), limit: '25', source: 'cache' })}`,
            { signal },
          ),
        );
        setPage({ ...data, key });
        setError('');
      } catch (e) {
        if (!isCancelled(e) && current.current.enabled === enabled)
          setError(errorText(e));
      }
    },
    3000,
    active && visible && !!enabled && !!machine && !target && !busy && auto,
    key + enabled,
  );
  useEffect(() => {
    if (active && enabled && machine && !auto) refreshCache();
  }, [key, active, enabled, auto]);
  async function readDevice() {
    if (!machine || directBusy) return;
    direct.current?.abort();
    const controller = new AbortController();
    direct.current = controller;
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
      if (direct.current === controller) setDirectBusy(false);
    }
  }
  function openWrite(node) {
    if (!canWrite || node.stale) return;
    setTarget({ ...node, machine });
    setValue(node.value);
    setPhase('idle');
    setWriteError('');
    setReadback(null);
  }
  async function verify(operation) {
    setPhase('reading');
    setWriteError('');
    try {
      const actual = await api(
        `/nodes/value?${new URLSearchParams({ machine: operation.machine, code: operation.code })}`,
      );
      if (
        !actual ||
        actual.code !== operation.code ||
        !actual.observedAt ||
        actual.quality >>> 30 !== 0
      )
        throw new Error('设备回读未得到质量正常的当前值，请重新读取确认');
      setReadback({ ...actual, writeAccepted: !!operation.accepted });
      setVerification(null);
      setPhase('confirmed');
      setPage((previous) =>
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
      return true;
    } catch (e) {
      if (!isCancelled(e) && current.current.enabled === enabled) {
        setPhase('unknown');
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
  async function write(event) {
    event.preventDefault();
    if (!target || phase !== 'idle' || !canWrite) return;
    setPhase('writing');
    setWriteError('');
    const operation = {
      machine: target.machine,
      code: target.code,
      requested: value,
    };
    setVerification(operation);
    try {
      const accepted = await api('/nodes/write', {
        method: 'POST',
        body: { machine: operation.machine, code: operation.code, value },
      });
      operation.operationId = accepted?.operationId;
      operation.accepted = true;
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
  async function rediscover() {
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
  function updateScan(statuses) {
    if (!scan || !['browsing', 'snapshot'].includes(scan.state)) return;
    const status = statuses.find((s) => s.code === scan.machine);
    if (
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
  const capturedAt = Date.parse(
    currentPage?.capturedAt || currentPage?.readAt || '',
  );
  const viewStale =
    !!error ||
    !!currentPage?.stale ||
    (!auto &&
      (!Number.isFinite(capturedAt) || Date.now() - capturedAt > 15000));
  const canWrite =
    allowWrite &&
    !!currentPage &&
    !viewStale &&
    !error &&
    !busy &&
    !verification;
  return {
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
