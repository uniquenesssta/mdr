# R16-04 HTML 清理

## 范围与基线

用户要求“收尾03开始04”。R16-03已在52aa8f2 / CI39988412402精确验收，收尾提交40cea4fb83e17c5c0b1df79c3d2b38c3f20e8f1c；继续唯一codex/r16-stage，仅执行16.4，16.5未开始。用户AGENTS.md既有修改保留，不纳入提交。冻结模型、Rust、磁盘格式、依赖及锁文件保持。回退使用本项实现提交的git revert，不重置用户文件。

## 现状与实施

index.html在阶段2已实现最小入口，本项再次核对其标准head、唯一app-root和ESM入口，入口中无业务DOM、图标sprite、弹窗、内联样式或事件，不为制造改动重写已满足的入口。外部public/assets/icons.svg仍是正确图标资源，不删除有效图标。四个现用链接/查找/图片/Mermaid对话框由ModalShell拥有焦点及销毁，不是index中的旧弹窗或第二份实现。

真正残留位于public/compatibility/business-content.html：10个onclick引用已退役的全局函数。当前MenuView在启动时会移除它们，并经MenuController/Bindings派发显式命令；现直接从交付HTML清除这些无效回退。未改变节点、文案、class、图标、布局、交互政策或可访问性属性，本项没有UI视觉/交互设计变更；已核对Figma规则，不新建设计或改写现有设计。兼容业务模板与挂载端口按2.11及16.8既定安排保留；不能将其移到本项机械改名或删除。独立Image Menu指针焦点发现继续保留原UI/Figma交接。

## 原意到当前断言映射

- newDocument / renameCurrentDocument → document.new / document.rename-active，显式文档命令各一次并关闭菜单。
- toggleSidebar / setLayoutMode的both、edit、preview → layout.toggle-sidebar及layout.mode.*，保留动作参数和关闭菜单。
- togglePageFullscreen / toggleFullscreen → layout.fullscreen.page-toggle / system-toggle，沿既有编辑器命令能力派发。单元测试证明路由，不冒充原生全屏验收。
- toggleTableVisualEditing / toggleCodeVisualEditing → editor.table.visual-toggle / code.visual-toggle，保留原事件和closeMenu=false。
- 旧157以内上限 → 原始HTML解析与当前exact baseline均为零；原阶段0的184事件历史清单不改写。10项移除记录保留在architecture-baseline的auditCorrections.r16HtmlCleanup，不能重获豁免。

实际生产HTML解析后通过真实MenuView、Controller、Bindings和命令适配器验证上述10条路由；新增失败报告→重试恢复及销毁后旧节点点击不派发。另以零基线夹具验证入口及兼容模板的onclick/onchange/oninput注入均被门禁拒绝。CI新增9项HTML专项，完整Node、浏览器与Windows累计门禁保持；触发范围补齐index.html及public/**，覆盖HTML单独变化。实际浏览器的已有壳场景还验证HTTP交付的原始模板没有任何on*属性，不能靠启动时移除属性掩盖源HTML。

## 验证与当前状态

先收紧零事件断言，旧源码3项中2通过/1失败，明确发现10个残留；清理后HTML专项9/9通过。首次本地构建因Vite父目录缓存写入权限失败；首次浏览器契约11项行为完成后因测试浏览器taskkill权限失败，均未记为通过。使用授权执行环境后生产构建通过，浏览器契约11/11，保留原日志。随后完成下方全仓与风险指纹核对；R16-04已实现，待本提交完整Windows CI验收，尚未勾选；推送后停止轮询。

完整实际页面首次在系统Node24.16.0/Undici7.25.0下为37通过/38失败：首个导出场景CDP connection closed，后续因同一连接关闭无法执行；未将其归为已知产品缺陷或伪称通过。保持同一生产产物及所有原断言/时限，改用此前已验证的bundled Node24.19.0/Undici7.29.0后75/75完整通过。该对照证明当前产物在此环境通过，底层断连原因尚未证明。日志为Temp/mdr-r1604-browser-app.log与mdr-r1604-browser-app-runtime24.log；成功页面console/exception均0，原始HTTP模板零内联事件验证通过。

生产构建来源指纹f8ed6b0de4d8680f67f2d40f7166f999152d42a06a6cae1fa5769bcc96d369f5，511输入/137输出，主包586.78KB；500000/700000字节预算未变。与52aa8f2的原模板逐字核对，差异仅10个onclick属性。全部10项受保护源哈希保持，570个生产模块；删除清单1132输入/104候选，37已缺席、59仍引用、6受保护、2未证明，全部deletionAllowed=false，没有文件删除。

## 最终交付验证

全仓跟踪Node测试2740/2740（362文件/16目录），失败/跳过/取消均0，目录级退出码全部0；9项HTML专项及200项风险源SHA核对通过，四项架构/旧运行时/生成文件/README门禁通过。浏览器契约11/11与最终生产包实际页面75/75通过，没有改动产品JS、CSS、模型、Rust、依赖或数据格式。全仓证据为Temp/mdr-r1604-repository-tests.log及mdr-r1604-repository/repository-audit。

本项未重复Rust编译和本地原生大文档链：相关Rust/IPC/正文保存源码无变化，03的301项Rust与原生链仅作已验收基线，不冒充04同提交证据；新实现提交仍必须通过完整Windows累计CI。04保持未验收，05未开始。提交并推送现有分支后停止CI查询，等用户通知。

## 正式验收（2026-10-24）

实现提交804950fdc58fb973561f6a4e53c273473258a104的[CI40060322282](https://github.com/uniquenesssta/mdr/actions/runs/40060322282)七组Windows及全部步骤成功。closeout-verification.json accepted=true、commit及run精确匹配；Rust301、全仓Node2740（362文件/16目录）、HTML9、浏览器11＋75及四项门禁通过，真实WebView安全边界、导入8场景、大文档4路、原生图片与四格式写入链通过。R16-04正式收尾；系统Node24.16断连与bundled24.19通过的本地历史保持，不据后续CI反推底层原因。

归档12546628442（closeout，9621字节）SHA256=22e9fc7a48c03daf4261621dab8d1a2d537eb32c9fa0a7b183261b91415906ab；12547421954（WebView，1343523字节）SHA256=476bd74cb958d57e4c4d45b17c81b87f80ea6d163e0ae95c14be62af5f077ca1，均已下载核对一致。

按用户“收尾04开始05”，继续唯一codex/r16-stage执行16.5 CSS清理，保持现有主题和布局，不推进16.6。兼容挂载退出仍归16.8，独立Image Menu指针焦点发现保留原UI/Figma交接；推送后停止CI查询。
