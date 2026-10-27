/**
 * 模拟方案编辑器：读取配置 → 复制成草稿 → 编辑/校验/导入 → 带 revision 保存。
 * document 是服务端配置基线（不是浏览器 DOM 的 document），draft 是本地待保存内容。
 * runtime 单独存放规则进度和轨迹，后台刷新它不会覆盖用户正在输入的 draft。
 */
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

// 字段键与中文标签按同一下标对应，用于批量生成每个节点的五个数值编辑单元格。
const numericFields = ['baseline', 'min', 'max', 'amplitude', 'intervalMs'];
const numericLabels = ['基准值', '下限', '上限', '波动幅度', '波动周期 ms'];
/**
 * 数字控件适配器：浏览器提供字符串，父级 draft 需要 number，因此在输入边界统一转换。
 * 空框以 NaN 暂存，value 再映射为空字符串；Number('') 会变成 0，不能直接用它处理空框。
 * onChange 是调用者传入的业务回调，不是这里直接修改 draft；因此同一控件可复用于多处。
 */
function Numeric({ label, value, onChange, ...props }) {
  // 数字输入框的原生 value 仍是字符串；空值暂存为 NaN，提交前统一提示未填写。
  // ...props 将 min、max、aria-label 等由调用者指定的属性传递给原生 input。
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
/** 递归检查配置草稿中是否存在未填写或非有限数值（NaN / Infinity），防止序列化为 null。 */
function invalidNumbers(value) {
  // 递归检查整份草稿，包括当前筛选隐藏的节点；JSON 会把 NaN 转成 null，故先拦截。
  if (typeof value === 'number') return !Number.isFinite(value);
  return (
    value &&
    typeof value === 'object' &&
    Object.values(value).some(invalidNumbers)
  );
}

/**
 * active：配置页是否正在显示，仅控制运行状态自动刷新，不代表是否挂载此编辑器。
 * onSaved：保存并应用完成后的父级通知，让外层同步节点视图和显示成功提示。
 * document：上次读取/保存的完整服务端文档，包含 revision、持久化标志与配置基线。
 * draft：独立待保存方案；nodes：节点名称/类型目录，给配置中的数字 ID 补全显示信息。
 * busy/error：操作锁与失败信息；section/search/pageIndex：页签、筛选和当前页。
 * runtime：运行进度/事件，只读展示；validation：校验、导入和运行查询的说明文案。
 * controller：当前加载请求的取消器；importFile：隐藏文件输入框的 DOM 引用。
 */
export default function Simulation({ active, onSaved }) {
  // useId 为两组 tab/panel 建立无障碍关联，同一页面存在多个组件实例时也能避免冲突。
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
  // 目录数组变化才重建索引；Map 让每个 profile 找到名称时无需扫描整个目录。
  const nodeMap = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  // 筛选后仍携带原数组 index，编辑第一个搜索结果时才能更新到它在 draft.nodes 的位置。
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
  // 节点配置每页 50 项；筛选缩小后即便旧页码很大，也落在仍然存在的最后一页。
  const safePage = Math.min(
    pageIndex,
    Math.max(0, Math.ceil(matchedProfiles.length / 50) - 1),
  );
  useEffect(() => setPageIndex(0), [search]);
  // 每 2 秒只读运行态；首次配置加载成功且不忙碌时才启动，隐藏页面时暂停。
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

  /** 并行加载节点目录与模拟配置，校验节点 ID 一致性后初始化服务端基线与本地深拷贝草稿。 */
  async function load() {
    // 重新加载先取消上次加载，再并行读取目录和配置；避免旧结果覆盖新一次加载。
    controller.current?.abort();
    const cancellation = new AbortController();
    controller.current = cancellation;
    setBusy(true);
    setError('');
    try {
      // 两个请求互不依赖，Promise.all 并行等待；其中一个失败就不建立半份编辑基线。
      const [catalog, result] = await Promise.all([
        request('/api/server/nodes', { signal: cancellation.signal }),
        request('/api/server/simulation', { signal: cancellation.signal }),
      ]);
      const catalogIDs = new Set(catalog.nodes.map((node) => node.id));
      // 方案按节点 ID 匹配，名称仅用于展示；目录和配置不一致时要求重新读取。
      if (result.config.nodes.some((profile) => !catalogIDs.has(profile.id)))
        throw new Error('节点列表已变化，请重新加载');
      setNodes(catalog.nodes);
      setDocument(result);
      // 深复制打断与服务端基线的引用共享，后续编辑不会顺手改掉“原始配置”。
      setDraft(structuredClone(result.config));
    } catch (e) {
      if (!isCancelled(e)) setError(errorText(e));
    } finally {
      // 旧 load 被新 load 取消后，旧 finally 不能提前解除新请求设置的 busy。
      if (!cancellation.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, []);
  // dirty 从草稿与基线比较得到；内部导航保留组件，浏览器刷新/关闭则需退出提醒。
  // 这里比较纯 JSON 配置，不含函数/循环引用；只是判断是否变化，不做业务合法性校验。
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
  /** 不可变地更新模拟草稿的顶层属性（如 enabled / tickMs）或对 rules 数组进行增删。 */
  function change(update) {
    // 针对顶层字段或 rules 数组增删：先复制将被修改的层，再把副本交给 update。
    setDraft((previous) => {
      // 此入口允许更新顶层字段或增删 rules 数组；若改规则内部字段，应走 ruleChange。
      const next = { ...previous, rules: [...previous.rules] };
      update(next);
      return next;
    });
  }
  /** 不可变地更新指定下标业务规则：深拷贝目标规则及其嵌套 steps/outputs 数组后执行修改。 */
  function ruleChange(index, update) {
    // 规则含 steps/outputs 嵌套数组，所以深复制目标规则后才允许修改内部对象。
    setDraft((previous) => {
      const rules = [...previous.rules];
      rules[index] = structuredClone(rules[index]);
      // 回调可对这个新副本做局部赋值/splice；最终返回的新 draft 才交给 React 保存。
      update(rules[index]);
      return { ...previous, rules };
    });
  }
  /** 不可变地更新单个节点的动态模拟参数，仅浅拷贝 nodes 数组与目标节点对象。 */
  function updateProfile(index, key, value) {
    // 只复制节点数组和被改的一个 profile，其他节点引用可复用，避免整份草稿深复制。
    setDraft((previous) => {
      const nodes = [...previous.nodes];
      nodes[index] = { ...nodes[index], [key]: value };
      return { ...previous, nodes };
    });
  }
  /** 调用后端接口预校验当前模拟草稿合法性，仅验证不落盘、不改变运行状态。 */
  async function validateDraft() {
    // 校验只验证方案，不落盘、不应用；成功后也不能把 dirty 清除。
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
  /** 从本地 JSON 文件导入模拟方案：完成文件大小、契约结构、已知节点 ID 与后端规则四重校验后载入草稿。 */
  async function importDraft(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    // 清空原生文件选择值，允许用户再次选择同名文件；文件内容仍保存在 file 变量里。
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
      // accept 仅是文件选择提示，不保证真实内容合法；必须实际读取和解析文件。
      const parsed = JSON.parse(await file.text());
      // JSON.parse 只检查 JSON 语法；parseSimulationConfig 再检查结构和已知节点 ID。
      // 最后还要交给 Go 校验业务规则，全部通过才替换本地草稿，导入不会直接应用。
      const config = parseSimulationConfig(
        parsed && typeof parsed === 'object' && 'config' in parsed
          ? parsed.config
          : parsed,
        // 用 ID 集合严格匹配现有目录；不能按可能重复、可能被改名的节点名称猜测映射。
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
  /** 生成新业务规则输出的默认参数，优先选取已启用动态模拟的节点作为默认目标。 */
  function newOutput() {
    // 默认输出尽量选择已启用节点；真正的延迟、渐变和规则执行发生在 Go 模拟服务。
    const node = draft.nodes.find((n) => n.enabled) || draft.nodes[0];
    return {
      nodeId: node?.id ?? 0,
      target: node?.baseline ?? 0,
      delayMs: 0,
      durationMs: Math.max(3000, draft.tickMs),
    };
  }
  /** 携带乐观锁 revision 保存并应用模拟配置，成功后同步基线并重置规则运行进度。 */
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
      // 使用上次成功读取的 revision 保存；成功后以服务器规范化结果更新基线与草稿。
      const saved = await request('/api/server/simulation', {
        method: 'PUT',
        body: { revision: document.revision, config: draft },
        signal: controller.current.signal,
      });
      // 后端可能规范化参数或递增版本；成功后以其返回值作为下一轮保存的新基线。
      setDocument(saved);
      setDraft(structuredClone(saved.config));
      // 只在真正保存成功后通知外层；单独校验或导入草稿不会触发这条通知。
      onSaved();
    } catch (e) {
      // 409 只显示冲突，保留 draft；不能静默重新读取后覆盖当前编辑内容。
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
  /** 模拟配置页签的键盘无障碍导航：支持左右方向键与 Home/End 切换页签并同步焦点。 */
  function navigateTabs(event) {
    // tab 的选中状态和键盘焦点一起移动；Home/End 与左右键支持纯键盘操作。
    // 两个页签所以左右键都切到另一个；Home/End 则选择固定首尾项。
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
  // JSX 是状态的投影：section 切换节点/规则，busy 一次禁用整个 fieldset。
  // 规则 key 使用 rule.id；运行进度按同一 ID 关联，不按可能变化的显示顺序关联。
  // 轨迹后端最多保留 128 条，这里展开后反转副本，只展示最近 50 条。
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
      {/* noValidate 关闭浏览器逐项约束提示；保存逻辑会检查整份草稿，含当前隐藏的数值。 */}
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
        {/* 运行版本与编辑基线不同只提示比较，不把新运行版本自动写进 draft。 */}
        {runtime && (
          <p className="editor-sync">
            规则状态同步：{time(runtime.capturedAt)}
            {runtime.revision !== document?.revision
              ? ' · 服务端版本已变化，保存前请重新加载并比较草稿。'
              : ''}
          </p>
        )}
        {/* 首次加载前 draft=null，不能访问其字段；成功后再显示并启用完整表单。 */}
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
            {/* tab ID 与 panel ID 成对对应；选中项可进入 Tab 顺序，其余项用方向键访问。 */}
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
            {/* 切换只改变显示区域；节点与规则数据都在同一 draft，切页签不会丢掉输入。 */}
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
                      {/* index 是筛选前的原始下标，更新时不会误改为搜索结果位置对应的其他节点。 */}
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
                {/* rule.id 是稳定身份；规则名称可编辑，因此不能用名称作为 key。 */}
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
                      {/* steps 的数组顺序就是业务触发顺序；每次修改经 ruleChange 复制目标规则。 */}
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
                      {/* 输出描述目标、延迟与渐变时长；实际调度由 Go 执行，浏览器不模拟写入。 */}
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
                    {/* 按规则 ID 关联实时进度；runtime 尚未返回时回退到加载文档中的初始进度。 */}
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
            {/* datalist 提供节点 ID 建议而不是强制选择；最终 ID 是否有效仍需校验。 */}
            <datalist id="simulation-node-options">
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} · {node.type}
                </option>
              ))}
            </datalist>
          </fieldset>
        )}
        {/* 自定义“导入方案”按钮通过 ref.click 打开文件框，仍复用浏览器原生文件选择器。 */}
        <input
          ref={importFile}
          type="file"
          accept="application/json,.json"
          aria-label="导入模拟方案文件"
          hidden
          onChange={importDraft}
        />
        {/* 展示反转的是数组副本，不修改 runtime.events；轨迹只读，不参与 dirty 判断。 */}
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
        {/* 最后一个按钮未写 type，作为 submit 进入 save；其他按钮均独立处理，不触发表单保存。 */}
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
