import { parseSimulationConfig } from './api/contracts';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from './components/Icon.jsx';
import {
  Alert,
  Field,
  download,
  errorText,
  isCancelled,
  request,
  time,
  usePolling,
  useVisible,
} from './shared.jsx';

const numericFields = ['baseline', 'min', 'max', 'amplitude', 'intervalMs'];
const numericLabels = ['基准值', '下限', '上限', '波动幅度', '波动周期 ms'];
function Numeric({ label, value, onChange, ...props }) {
  return (
    <Field label={label}>
      <input
        type="number"
        step="any"
        required
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) =>
          onChange(e.target.value === '' ? NaN : Number(e.target.value))
        }
        {...props}
      />
    </Field>
  );
}
function invalidNumbers(value) {
  if (typeof value === 'number') return !Number.isFinite(value);
  return (
    value &&
    typeof value === 'object' &&
    Object.values(value).some(invalidNumbers)
  );
}

export default function Simulation({ active, onSaved }) {
  const tabsID = useId();
  const [document, setDocument] = useState(null),
    [draft, setDraft] = useState(null),
    [nodes, setNodes] = useState([]);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [section, setSection] = useState('nodes'),
    [search, setSearch] = useState('');
  const controller = useRef(null),
    importFile = useRef(null);
  const [pageIndex, setPageIndex] = useState(0),
    [runtime, setRuntime] = useState(null),
    [validation, setValidation] = useState('');
  const visible = useVisible();
  const nodeMap = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const matchedProfiles = useMemo(
    () =>
      draft
        ? draft.nodes
            .map((profile, index) => ({ profile, index }))
            .filter(({ profile }) =>
              `${profile.id} ${nodeMap.get(profile.id)?.name || ''}`
                .toLowerCase()
                .includes(search.trim().toLowerCase()),
            )
        : [],
    [draft?.nodes, nodeMap, search],
  );
  const safePage = Math.min(
    pageIndex,
    Math.max(0, Math.ceil(matchedProfiles.length / 50) - 1),
  );
  useEffect(() => setPageIndex(0), [search]);
  usePolling(
    async (signal) => {
      try {
        setRuntime(await request('/api/server/simulation/status', { signal }));
      } catch (error) {
        if (!isCancelled(error))
          setValidation('运行状态读取失败：' + errorText(error));
      }
    },
    2000,
    active && visible && !!document && !busy,
  );

  async function load() {
    controller.current?.abort();
    const cancellation = new AbortController();
    controller.current = cancellation;
    setBusy(true);
    setError('');
    try {
      const [catalog, result] = await Promise.all([
        request('/api/server/nodes', { signal: cancellation.signal }),
        request('/api/server/simulation', { signal: cancellation.signal }),
      ]);
      const catalogIDs = new Set(catalog.nodes.map((node) => node.id));
      if (result.config.nodes.some((profile) => !catalogIDs.has(profile.id)))
        throw new Error('节点列表已变化，请重新加载');
      setNodes(catalog.nodes);
      setDocument(result);
      setDraft(structuredClone(result.config));
    } catch (e) {
      if (!isCancelled(e)) setError(errorText(e));
    } finally {
      if (!cancellation.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, []);
  const dirty = useMemo(
    () => document && JSON.stringify(draft) !== JSON.stringify(document.config),
    [draft, document?.config],
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(update) {
    setDraft((previous) => {
      const next = { ...previous, rules: [...previous.rules] };
      update(next);
      return next;
    });
  }
  function ruleChange(index, update) {
    setDraft((previous) => {
      const rules = [...previous.rules];
      rules[index] = structuredClone(rules[index]);
      update(rules[index]);
      return { ...previous, rules };
    });
  }
  function updateProfile(index, key, value) {
    setDraft((previous) => {
      const nodes = [...previous.nodes];
      nodes[index] = { ...nodes[index], [key]: value };
      return { ...previous, nodes };
    });
  }
  async function validateDraft() {
    if (!draft || busy) return;
    if (invalidNumbers(draft)) {
      setError('请填写所有数值字段');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request('/api/server/simulation/validate', {
        method: 'POST',
        body: { revision: document.revision, config: draft },
      });
      setValidation('配置校验通过，尚未保存。');
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function importDraft(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('模拟方案文件不能超过 2 MiB');
      return;
    }
    if (dirty && !window.confirm('导入会替换当前未保存草稿，确认继续？'))
      return;
    setBusy(true);
    setError('');
    try {
      const parsed = JSON.parse(await file.text());
      const config = parseSimulationConfig(
        parsed && typeof parsed === 'object' && 'config' in parsed
          ? parsed.config
          : parsed,
        new Set(nodes.map((node) => node.id)),
      );
      await request('/api/server/simulation/validate', {
        method: 'POST',
        body: { revision: document.revision, config },
      });
      setDraft(structuredClone(config));
      setValidation('模拟方案已校验并载入草稿，尚未保存；节点按 ID 严格匹配。');
      setPageIndex(0);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  function newOutput() {
    const node = draft.nodes.find((n) => n.enabled) || draft.nodes[0];
    return {
      nodeId: node?.id ?? 0,
      target: node?.baseline ?? 0,
      delayMs: 0,
      durationMs: Math.max(3000, draft.tickMs),
    };
  }
  async function save(event) {
    event.preventDefault();
    if (busy || !draft) return;
    if (invalidNumbers(draft)) {
      setError('请填写所有数值字段，包括筛选隐藏的节点和业务规则。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await request('/api/server/simulation', {
        method: 'PUT',
        body: { revision: document.revision, config: draft },
        signal: controller.current.signal,
      });
      setDocument(saved);
      setDraft(structuredClone(saved.config));
      onSaved();
    } catch (e) {
      if (!isCancelled(e))
        setError(
          errorText(e) +
            (e.status === 409
              ? '。草稿已保留，请重新加载最新配置后编辑。'
              : ''),
        );
    } finally {
      setBusy(false);
    }
  }
  function navigateTabs(event) {
    const next = {
      ArrowLeft: section === 'nodes' ? 'rules' : 'nodes',
      ArrowRight: section === 'nodes' ? 'rules' : 'nodes',
      Home: 'nodes',
      End: 'rules',
    }[event.key];
    if (!next) return;
    event.preventDefault();
    setSection(next);
    event.currentTarget.querySelector(`[data-section="${next}"]`).focus();
  }
  return (
    <section className="panel simulation-panel">
      <div className="panel-heading">
        <h2>
          <Icon name="sliders" size={17} />
          动态值与业务模拟
        </h2>
        <span className="subtle">
          {dirty ? '有未保存的修改' : document ? '配置已同步' : '正在加载…'}
        </span>
      </div>
      <form
        className="simulation-editor panel-content"
        aria-label="模拟服务配置"
        onSubmit={save}
        noValidate
      >
        <p className="editor-note">
          {document
            ? `${document.persistent ? '配置保存到状态文件，重启后恢复。' : '当前为内存模式，重启后失效。'} ${document.running ? '模拟正在运行。' : '模拟当前未运行；请检查启动参数与启用设置。'} 保存会重置规则进度，并让启用节点回到基准值。`
            : '正在加载配置…'}
        </p>
        <Alert>{error}</Alert>
        {validation && <Alert kind="info">{validation}</Alert>}
        {runtime && (
          <p className="editor-sync">
            规则状态同步：{time(runtime.capturedAt)}
            {runtime.revision !== document?.revision
              ? ' · 服务端版本已变化，保存前请重新加载并比较草稿。'
              : ''}
          </p>
        )}
        {draft && (
          <fieldset disabled={busy}>
            <div className="fields-grid simulation-basic">
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) =>
                    change((next) => {
                      next.enabled = e.target.checked;
                    })
                  }
                />
                启用动态值和业务规则
              </label>
              <Numeric
                label="刷新间隔（毫秒）"
                min="50"
                max="5000"
                value={draft.tickMs}
                onChange={(v) =>
                  change((next) => {
                    next.tickMs = v;
                  })
                }
              />
            </div>
            <div
              className="simulation-tabs"
              role="tablist"
              aria-label="模拟配置内容"
              onKeyDown={navigateTabs}
            >
              {[
                ['nodes', '节点动态值'],
                ['rules', '业务规则'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="simulation-tab"
                  role="tab"
                  id={`${tabsID}-${value}-tab`}
                  data-section={value}
                  aria-selected={section === value}
                  aria-controls={`${tabsID}-${value}-panel`}
                  tabIndex={section === value ? 0 : -1}
                  onClick={() => setSection(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {section === 'nodes' ? (
              <section
                role="tabpanel"
                id={`${tabsID}-nodes-panel`}
                aria-labelledby={`${tabsID}-nodes-tab`}
              >
                <p>
                  节点在上下限内围绕基准值波动。幅度为绝对值，0
                  表示固定控制量；整数类型使用整数，Bit 使用 0 / 1。
                </p>
                <Field label="筛选模拟节点">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="名称或节点 ID"
                  />
                </Field>
                <div className="table-scroll">
                  <table className="simulation-table">
                    <thead>
                      <tr>
                        <th>节点</th>
                        <th>启用</th>
                        {numericLabels.map((label) => (
                          <th key={label}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matchedProfiles
                        .slice(safePage * 50, safePage * 50 + 50)
                        .map(({ profile, index }) => {
                          const node = nodeMap.get(profile.id);
                          return (
                            <tr key={profile.id}>
                              <td>
                                <strong>{node?.name || profile.id}</strong>
                                <small>
                                  ns=1;i={profile.id} · {node?.type}
                                </small>
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`启用节点 ${profile.id} 模拟`}
                                  checked={profile.enabled}
                                  onChange={(e) =>
                                    updateProfile(
                                      index,
                                      'enabled',
                                      e.target.checked,
                                    )
                                  }
                                />
                              </td>
                              {numericFields.map((key, i) => (
                                <td key={key}>
                                  <Numeric
                                    label={numericLabels[i]}
                                    aria-label={`${numericLabels[i]}，节点 ${profile.id}`}
                                    value={profile[key]}
                                    onChange={(v) =>
                                      updateProfile(index, key, v)
                                    }
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer">
                  <span>匹配 {matchedProfiles.length} 个节点 · 每页 50 个</span>
                  <div className="actions">
                    <button
                      type="button"
                      className="button small"
                      disabled={!safePage}
                      onClick={() => setPageIndex(safePage - 1)}
                    >
                      上一页
                    </button>
                    <span>{safePage + 1}</span>
                    <button
                      type="button"
                      className="button small"
                      disabled={(safePage + 1) * 50 >= matchedProfiles.length}
                      onClick={() => setPageIndex(safePage + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <section
                role="tabpanel"
                id={`${tabsID}-rules-panel`}
                aria-labelledby={`${tabsID}-rules-tab`}
              >
                <p>
                  成功写入且值实际改变时推进步骤。全部步骤须在窗口内按顺序完成；输出支持延迟和平滑渐变。无关节点写入被忽略。
                </p>
                {draft.rules.map((rule, index) => (
                  <article className="simulation-rule" key={rule.id}>
                    <div className="simulation-rule-heading">
                      <div className="rule-title">
                        <span className="rule-number" aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <h3>业务规则 {index + 1}</h3>
                      </div>
                      <button
                        type="button"
                        className="button small"
                        onClick={() =>
                          change((next) => {
                            next.rules.splice(index, 1);
                          })
                        }
                      >
                        删除规则
                      </button>
                    </div>
                    <div className="fields-grid rule-settings">
                      <Field label="规则名称">
                        <input
                          value={rule.name}
                          maxLength="256"
                          onChange={(e) =>
                            ruleChange(index, (r) => {
                              r.name = e.target.value;
                            })
                          }
                        />
                      </Field>
                      <Numeric
                        label="匹配窗口（毫秒）"
                        value={rule.windowMs}
                        onChange={(v) =>
                          ruleChange(index, (r) => {
                            r.windowMs = v;
                          })
                        }
                      />
                      <label className="check rule-enabled">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) =>
                            ruleChange(index, (r) => {
                              r.enabled = e.target.checked;
                            })
                          }
                        />
                        <span>启用规则</span>
                      </label>
                    </div>
                    <section
                      className="rule-section"
                      aria-label={`业务规则 ${index + 1} 的触发步骤`}
                    >
                      <div className="rule-section-heading">
                        <h4>触发步骤</h4>
                        <span>在匹配窗口内，依次写入以下节点</span>
                      </div>
                      {rule.steps.map((step, stepIndex) => (
                        <div className="rule-step" key={stepIndex}>
                          <Numeric
                            label={`第 ${stepIndex + 1} 步节点 ID`}
                            list="simulation-node-options"
                            value={step.nodeId}
                            onChange={(v) =>
                              ruleChange(index, (r) => {
                                r.steps[stepIndex].nodeId = v;
                              })
                            }
                          />
                          <Field label="匹配条件">
                            <select
                              value={step.operator}
                              onChange={(e) =>
                                ruleChange(index, (r) => {
                                  r.steps[stepIndex].operator = e.target.value;
                                  if (e.target.value === 'changed')
                                    r.steps[stepIndex].value = '';
                                })
                              }
                            >
                              {[
                                ['changed', '值发生变化'],
                                ['eq', '等于'],
                                ['ne', '不等于'],
                                ['gt', '大于'],
                                ['gte', '大于或等于'],
                                ['lt', '小于'],
                                ['lte', '小于或等于'],
                              ].map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="比较值">
                            <input
                              disabled={step.operator === 'changed'}
                              placeholder={
                                step.operator === 'changed'
                                  ? '无需比较值'
                                  : '输入比较值'
                              }
                              value={step.value}
                              onChange={(e) =>
                                ruleChange(index, (r) => {
                                  r.steps[stepIndex].value = e.target.value;
                                })
                              }
                            />
                          </Field>
                          <button
                            type="button"
                            className="button small rule-remove"
                            onClick={() =>
                              ruleChange(index, (r) => {
                                r.steps.splice(stepIndex, 1);
                              })
                            }
                          >
                            移除步骤
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="button"
                        onClick={() =>
                          ruleChange(index, (r) => {
                            r.steps.push({
                              nodeId: draft.nodes[0]?.id ?? 0,
                              operator: 'changed',
                              value: '',
                            });
                          })
                        }
                      >
                        ＋ 添加下一步
                      </button>
                    </section>
                    <section
                      className="rule-section"
                      aria-label={`业务规则 ${index + 1} 的执行输出`}
                    >
                      <div className="rule-section-heading">
                        <h4>执行输出</h4>
                        <span>全部步骤匹配后，按延迟和渐变设置更新节点</span>
                      </div>
                      {rule.outputs.map((output, outputIndex) => (
                        <div className="rule-output" key={outputIndex}>
                          {[
                            ['nodeId', '输出节点 ID'],
                            ['target', '目标值'],
                            ['delayMs', '延迟（毫秒）'],
                            ['durationMs', '渐变时间（毫秒）'],
                          ].map(([key, label]) => (
                            <Numeric
                              key={key}
                              label={label}
                              list={
                                key === 'nodeId'
                                  ? 'simulation-node-options'
                                  : undefined
                              }
                              value={output[key]}
                              onChange={(v) =>
                                ruleChange(index, (r) => {
                                  r.outputs[outputIndex][key] = v;
                                })
                              }
                            />
                          ))}
                          <button
                            type="button"
                            className="button small rule-remove"
                            onClick={() =>
                              ruleChange(index, (r) => {
                                r.outputs.splice(outputIndex, 1);
                              })
                            }
                          >
                            移除输出
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="button"
                        onClick={() =>
                          ruleChange(index, (r) => {
                            r.outputs.push(newOutput());
                          })
                        }
                      >
                        ＋ 添加输出
                      </button>
                    </section>
                    {(runtime?.rules || document.rules)
                      .filter((status) => status.id === rule.id)
                      .map((status) => (
                        <p className="rule-runtime" key={status.id}>
                          实时进度 {status.matchedSteps} / {rule.steps.length}
                          ，累计触发 {status.triggerCount} 次，最近触发{' '}
                          {time(status.lastTriggered)}
                        </p>
                      ))}
                  </article>
                ))}
                {!draft.rules.length && (
                  <div className="rules-empty">
                    尚未配置业务规则。新增规则后，设置触发步骤与执行输出。
                  </div>
                )}
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    change((next) => {
                      next.rules.push({
                        id: `rule-${globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2)}`,
                        name: `顺序联动 ${draft.rules.length + 1}`,
                        enabled: true,
                        windowMs: 10000,
                        steps: [
                          {
                            nodeId: draft.nodes[0]?.id ?? 0,
                            operator: 'changed',
                            value: '',
                          },
                        ],
                        outputs: [newOutput()],
                      });
                    })
                  }
                >
                  ＋ 新增业务规则
                </button>
              </section>
            )}
            <datalist id="simulation-node-options">
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} · {node.type}
                </option>
              ))}
            </datalist>
          </fieldset>
        )}
        <input
          ref={importFile}
          type="file"
          accept="application/json,.json"
          aria-label="导入模拟方案文件"
          hidden
          onChange={importDraft}
        />
        <details className="simulation-trace">
          <summary>实时运行轨迹（最近 128 条，内存记录）</summary>
          <p>
            显示外部写入的匹配、超时和触发原因；保存配置或重启后清空，不作为完整历史。
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>规则</th>
                  <th>节点 / 值</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {[...(runtime?.events || [])]
                  .reverse()
                  .slice(0, 50)
                  .map((event) => (
                    <tr key={event.sequence}>
                      <td>{time(event.at)}</td>
                      <td>
                        {draft?.rules.find((rule) => rule.id === event.ruleId)
                          ?.name || event.ruleId}
                      </td>
                      <td>
                        {event.nodeId} / {event.value}
                      </td>
                      <td>{event.detail}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
        <div className="form-actions sticky-actions">
          <button
            type="button"
            className="button"
            disabled={busy || !draft}
            onClick={() => importFile.current.click()}
          >
            导入方案
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || !draft}
            onClick={validateDraft}
          >
            校验方案
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || !draft}
            onClick={() =>
              download(
                'opc-simulation.json',
                JSON.stringify(draft, null, 2),
                'application/json',
              )
            }
          >
            导出 JSON
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm('确认丢弃草稿并重新加载？')) load();
            }}
          >
            重新加载
          </button>
          <button className="button primary" disabled={busy || !draft}>
            {busy ? '正在处理…' : '保存并应用'}
          </button>
        </div>
      </form>
    </section>
  );
}
