/**
 * 统一 SVG 图标组件：shapes 按名称保存图形，界面通过 <Icon name="..." /> 复用。
 * 图形放在组件外，避免每次渲染都重新构造整张图标表；不依赖网络字体或图标库。
 */
const shapes = {
  // 文档图标：用于运行日志导航项与日志面板标题。
  fileText: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
      <path d="M14 2v6h6M8 12h8M8 16h8" />
    </>
  ),
  // 四宫格图标：用于系统总览导航项，同时作为未知图标名称的回退图形。
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  // 芯片图标：代表 OPC UA 模拟服务及设备接入阶段。
  cpu: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  // 折线脉冲图标：代表运行总览、实时监控、采集就绪与运行诊断。
  activity: <path d="M2 12h4l3-8 5 16 3-8h5" />,
  // 参数滑块图标：代表模拟配置（节点动态参数与业务规则编排）。
  sliders: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="8" cy="7" r="3" />
      <circle cx="16" cy="17" r="3" />
    </>
  ),
  // 齿轮图标：代表采集网关基本设置与安全配置。
  settings: (
    <>
      <path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-3Z" />
      <circle cx="11.5" cy="11.5" r="3" />
    </>
  ),
  // 服务器机架图标：代表采集网关服务分组与采集机组列表。
  server: (
    <>
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="M7 6.5h.01M7 17.5h.01M15 6.5h3m-3 11h3" />
    </>
  ),
  // 网络拓扑图标：代表工作台品牌标志、OPC UA 连接及实时数据链路。
  network: (
    <>
      <rect x="8" y="2" width="8" height="6" rx="1.5" />
      <rect x="2" y="16" width="7" height="6" rx="1.5" />
      <rect x="15" y="16" width="7" height="6" rx="1.5" />
      <path d="M12 8v4H5.5v4M12 12h6.5v4" />
    </>
  ),
  // 右箭头图标：用于协议流向指示与快捷跳转入口。
  arrowRight: <path d="M4 12h16m-6-6 6 6-6 6" />,
  // 下拉箭头图标：用于折叠面板（如配置差异审阅）的展开状态指示。
  chevronDown: <path d="m6 9 6 6 6-6" />,
  // 时钟图标：用于顶栏实时时钟与服务运行时间指标卡。
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  // 汉堡菜单图标：用于移动端顶栏展开侧边抽屉导航。
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  // 关闭叉号图标：用于移动端抽屉导航关闭按钮。
  x: <path d="m6 6 12 12M6 18 18 6" />,
  // 勾号图标：用于成功提示框、质量正常指标及健康状态提示。
  check: <path d="m5 12 4 4L19 6" />,
  // 警告三角图标：用于错误提示框与运行关注异常项。
  alert: (
    <>
      <path d="m10.3 3.7-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.3l-8-14a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4m0 4h.01" />
    </>
  ),
  // 信息圆标图标：用于中性说明提示框、数据策略与日志保留说明。
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10h.01" />
    </>
  ),
  // 双弧刷新图标：用于手动刷新节点、状态与日志按钮。
  refresh: (
    <>
      <path d="M20 7a8 8 0 0 0-14-1L3 9m0-6v6h6m-5 8a8 8 0 0 0 14 1l3-3m0 6v-6h-6" />
    </>
  ),
  // 下载箭头图标：用于导出 CSV、模拟方案 JSON、配置草稿与日志页面。
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  // 加号图标：用于新增模拟节点按钮。
  plus: <path d="M12 5v14M5 12h14" />,
  // 数据库圆柱图标：代表节点目录、数据监控与采集缓冲。
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7" />
    </>
  ),
  // 发送图标：代表 Kafka 消息发布与协议探测指标。
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2" />
    </>
  ),
  // 文件夹图标：代表配置差异对比与历史版本管理。
  folder: (
    <path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  ),
  // 眼睛图标：预留用于查看/观察类操作展示。
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // 搜索放大镜图标：用于节点与日志搜索输入框前缀。
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  // 暂停双竖线图标：用于暂停实时节点自动刷新按钮。
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  // 播放三角图标：用于恢复实时节点自动刷新按钮。
  play: <path d="m8 4 12 8-12 8V4Z" />,
};

/**
 * name：shapes 查找键，应与上方已定义图标名对应；未知名称会回退为默认 grid 图标。
 * size：同时设置宽高，默认 18；className：在基础 icon 类外补充调用方的样式类。
 * shapes 中 <>...</> 是 Fragment，组合多个 SVG 基元时不添加多余 DOM 包装层。
 * 这是普通展示组件，不需要 Effect 请求图标，也不应为每个图标创建额外 state。
 */
export default function Icon({ name, size = 18, className = '' }) {
  // currentColor 继承周围文字颜色；固定 viewBox 保持坐标比例，size 决定实际显示尺寸。
  // 图标是装饰性内容，aria-hidden 让读屏忽略；按钮的含义由外层文字/aria-label 提供。
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name] || shapes.grid}
    </svg>
  );
}
