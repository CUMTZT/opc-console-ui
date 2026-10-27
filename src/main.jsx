/**
 * 应用入口：浏览器从 index.html 加载这里，Vite 负责转换 JSX 和处理 CSS 导入。
 * 组件名以大写开头；<App /> 表示创建 App 组件对应的 React 元素。
 * createRoot 将 React 接到已有的 #root 容器，render 再交给 React 管理其中的界面。
 * 阅读顺序：main.jsx → App.jsx → shared.jsx → 各业务页面。
 */
// react-dom/client 提供浏览器端的根节点 API，和定义组件/Hooks 的 react 包分工不同。
import { createRoot } from 'react-dom/client';
// 默认导入 App：这里的变量名对应 App.jsx 的 export default，而非一个 HTML 标签。
import App from './App.jsx';
// CSS 导入没有绑定变量：交给 Vite 加载全局样式，后续组件的 className 都能使用。
import './styles.css';
// #root 由 index.html 提供；同一容器只创建一次根，不要放进组件函数里反复创建。
// render 接收描述界面的 React 元素；组件后续调用状态更新函数，由 React 调度重新渲染。
createRoot(document.getElementById('root')).render(<App />);
