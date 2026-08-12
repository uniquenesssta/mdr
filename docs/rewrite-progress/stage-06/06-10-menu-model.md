# Atomic 6.10 — Menu Model

## 任务边界

Atomic 6.10 只建立 Menu Model、状态、命令绑定、Controller/View 和必要的 scoped classic 适配边界。菜单声明只允许 `labelKey`、`commandId`、`shortcut`、`enabledSelector`、`visibleSelector`，不得直接调用保存、导入、导出等业务函数。Atomic 6.11 Submenu Positioner 与 Atomic 6.12 Recent Files Menu 未开始。

## 实际实现

新增并通过 `src/features/menu/index.js` 暴露以下职责模块：

- `menu-command-bindings.js`：稳定 Command ID、handler 注册/注销、执行和 close-after-execute 策略；不拥有业务或 UI 状态。
- `menu-state.js`：不可变菜单声明与 enabled/visible selector 状态；不依赖 DOM、业务函数、持久化或 Platform。
- `menu-controller.js`：把 selector 状态、CommandBindings 与 MenuView 编排为统一命令执行链，并负责生命周期和错误上报。
- `menu-view.js`：只把 Menu Model 投影到既有菜单 DOM，并通过 capture delegation 接管 command click；不实现 submenu 几何、延迟关闭或 recent-files 数据。
- `compatibility/classic-menu-command-adapter.js`：剩余 classic 命令的唯一过渡边界；优先走现有 Document/Editor UI command ports，未迁出的保存、导入、导出等调用仅在该 compatibility 文件中延迟解析。

`src/bootstrap/module-entry.js` 通过 Menu 公共入口组合 MenuState、Bindings、View、Controller 与 adapter；Help/Settings 直接注册到同一 CommandBindings。启动失败和应用销毁都按逆序释放注册、监听器和状态。

## 保持不变的行为

- 既有菜单文案和可见快捷键不改；快捷键本身仍由现有键盘链处理，本 Atomic 只在声明中记录 shortcut。
- 既有 top-level/submenu DOM 结构不改；submenu 定位、边界翻转、延迟关闭与焦点仍留给 6.11。
- Recent Files slot、数据读取和打开逻辑不迁入 Menu Model，留给 6.12。
- 表格/代码深度可视化开关继续保持点击后菜单不关闭；其余已迁移 command 保持执行后关闭菜单。
- 未修改 Frozen DocumentModel、持久化格式、Rust API、配置、默认值、安全策略或生产依赖。

## 验证事实

- 6.10 专项：Menu declaration 五字段限制、selector、CommandBindings、Controller、View、classic adapter 与公共入口回归均 PASS。
- 架构门禁：canonical Menu 模块无保存/导出等业务调用；bootstrap 只经 `src/features/menu/index.js` 进入；6.11/6.12 文件不存在；PASS。
- 候选全链 GitHub Actions run `31571287048`：Stage 4/5 与 6.1–6.9 交接、6.10 专项、语法、Frozen hash、Architecture、全量 Node、Browser Contract、生产 Build、Built App、证据上传全部 PASS。
- Frozen `src/document/document-model.js` hash 保持 `d767d9025be05a6f6b87d7cd3527782db1c3303a`。
- 前一候选 run `31570962841` 的唯一失败是根 README 超出仓库 `documentation-layout` 的 360 字限制；代码专项与 Architecture 当时已 PASS。根 README 精简后同一全链在 run `31571287048` 全部通过。

## 兼容性与限制

当前执行容器无法解析 `github.com`，因此不能取得真实本地 worktree 执行本地 `git status` 或整仓本地测试；远端正式基线通过不可变 commit SHA 锁定，并以 GitHub Actions 作为发布硬门禁。classic adapter 是阶段性兼容边界，不复制 Menu 状态；其剩余全局调用应随对应业务模块后续迁移而删除。
