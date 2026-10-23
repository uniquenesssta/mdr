# R15-12 Stale Dist

2026-10-23，用户要求“收尾11开始12”。前置R15-11实现89dd76c / CI39940004887七组Windows与全部步骤通过，收尾记录提交`5548c9059202970edc53387f622a2a90b1c2a4ab`；继续唯一`agent/r15-stage`。本项只实现源码与构建产物指纹准入，不改产品UI、模型、Rust、依赖和既有构建预算，不进入15.13。用户已有AGENTS.md末尾换行改动保留且不提交。

## 原职责与替代

旧Runner仅在页面启动后检查E2E全局是否存在，缺失时提示stale dist；带有相同全局的旧构建仍可能通过。原契约只检查两条错误字符串，并未比较源码或dist内容。当前删除这段推断，将“构建是否匹配”和“公共E2E能力是否安装”分别按各自证据检查。

`scripts/build/source-fingerprint.mjs`统一源码输入范围、路径和二进制SHA256算法。包含index.html、package.json、package-lock.json、vite.config.js以及src、public、scripts/build全部文件，包括未跟踪的新增输入。文件名、增加、移除、同长度内容变化都影响指纹；docs、tests、Git状态、日志和生成dist不属于产品构建输入。符号链接/目录联接及非法条目直接失败，避免静默漏掉真实输入或读取范围外文件。

`scripts/build/fingerprint-plugin.mjs`接入既有Vite生产构建，启动时记录源码指纹，输出后重新核对源码，再读取本轮实际输出文件和public复制文件的字节，写出`dist/mdr-build-fingerprint.json`。构建过程中源码变化则拒绝发布新指纹。清单不含正文内容、绝对路径、时间戳、浏览器全局或运行时采集。插件每次buildStart替换快照，无计时器、订阅、服务器或显式销毁资源；无第二份浏览器端指纹所有者。

`tests/e2e/lib/built-application-check.mjs`是Runner唯一准入检查。验证清单格式、版本、排序、重复路径、遍历/绝对路径和哈希结构；比较当前源码指纹，再逐项读取本轮输出字节，结束时复核源码未在检查途中变化。旧清单缺失、源码过时、输出缺失/变化、损坏清单均以STALE_DIST和具体reason失败；内容变化时给出最多五个相关相对路径，并明确提示`Run npm run build before npm run test:browser`。检查在Chromium和本地HTTP服务分配前执行，成功/失败都写`r15-12-build-fingerprint.json`；异常继续向上传播，不重试、不回退、不改变测试退出标准。

现有外部URL模式保留：它不使用本地dist，明确打印该模式未获本地dist指纹证明，页面仍须正常安装公共E2E能力。生产构建的指纹是本机测试一致性证据，不是外部站点身份认证。未被本轮构建引用的旧输出文件不计入本轮清单；本项不做15.13清理，也不清空用户目录。

## 覆盖与验证

先新增专项测试确认旧实现没有所需模块，入口以ERR_MODULE_NOT_FOUND失败，记录`mdr-r1512-before.log`。实现后33项专项通过：七类输入变化、新增/移除、同长度内容变化、无关文档排除、入口/JS/public输出被替换、输出/清单缺失、损坏JSON/SPA回退、九类非法清单、源缺失、目录联接拒绝、构建中变化及重新构建恢复。原五项E2E契约全部保留，其中过时的字符串断言替换为准入先于Chromium的接线检查，真实拒绝行为由专项覆盖；原构建预算、HTTP/Worker服务检查保持。相关45/45通过。

实际旧dist无指纹，执行原`npm run test:browser`立即以manifest-missing和退出1被拒绝，未进入浏览器分配，证据`mdr-r1512-before-build`。随后使用已有Node24.19和锁定依赖执行`npm run build -- --emptyOutDir false`，构建成功并保持500KB入口/700KB异步预算；禁用本轮清空输出目录，避免批量删除。新清单记录505项源码输入、140项产物，独立准入accepted=true。未增加生产依赖或更改系统Node。

最终本地验证：原75项实际页面75/75通过，独立浏览器交互11/11通过；正式全仓入口`npm exec --offline --call "node scripts/ci/run-repository-tests.mjs"`覆盖357测试文件、16目录，2668/2668通过，无失败、取消或跳过；四项架构门禁、9项现有收尾审计、119项当前源码指纹、语法与差异检查通过。历史R12 acceptance及R15-11精确提交验收对象经结构化比较均未改变。证据位于临时目录mdr-r1512-browser、mdr-r1512-contract、mdr-r1512-repository.log及mdr-r1512-build.log；浏览器准入记录accepted=true。本项未改Rust/原生源码，不重复本机Rust构建或将前置CI冒充本项验收。CI增加独立stale-dist.log步骤，七组原有工作及全部旧门禁保留；不会以本地构建代替精确提交Windows验收。推送后按用户要求停止CI轮询，等待用户通知或明确要求查看。

## 恢复与边界

整体回退本项实现提交，再按当时配置重新构建即可；无产品数据或持久化迁移。测试夹具使用临时小目录且不执行递归删除；真实浏览器/HTTP服务沿用原finally清理。R15-11独立图片菜单鼠标关闭后的焦点发现仍开放，未在本项修改UI或声称修复。15.12尚不标记正式验收，15.13未开始。
