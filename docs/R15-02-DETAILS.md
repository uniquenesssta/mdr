# R15-02 Recorder

当前唯一分支 `agent/r15-stage`；从 R15-01 验收提交 bc561a5（CI38357762013）继续。R15-01 七组 Windows 作业和全部步骤通过，24 基线、全仓2237、前端1230、浏览器11+67、Rust281；三份已下载产物摘要核验，最终同提交汇总 accepted=true。首轮失败及 R14 历史记录保留。

## 实施边界

`src/features/telemetry/index.js` 是公共入口，`performance-recorder.js` 唯一拥有输入规范化、frontend 八字段 envelope、session、时间、duration/status、结构化详情和同步/异步测量。实例显式注入 sessionId、wall/monotonic clocks、emit 和可选 aggregate；不读取 DOM、不安装全局、不创建计时器、不直接写文件。

旧 Runtime 的 record/measure/makeEntry/safeDetails 实现已删除，实际记录、诊断、聚合读回和可选包装器调用公共 Recorder。Runtime 暂时保留队列、聚合、诊断去重、DOM/Observer/生命周期与原有写入端口，它们分别属于15.4～15.8；不提前迁移不相关职责。当前 DEV 安装和生产无全局行为保持，完整 Runtime 生命周期销毁不在02声称完成。

| 输入 | 本项行为 |
| --- | --- |
| operation | 空、空白和非字符串不输出；合法动态名称保持 |
| category/status | 空值沿用默认ui.operation/ok；合法自定义字符串保持，真值非字符串拒绝 |
| durationMs | 保持原有 Number 转换、正常事件非负/三位小数、非有限null |
| session/time | 显式session不可为空，时间由注入时钟取得，拒绝非有限wall timestamp |
| details | 保留深度8、512节点、64键、数组20、字符串300和循环/异常保护；保留结构，不作敏感字段脱敏 |
| measure | 同步/异步结果与错误身份保持，懒详情失败回退空对象 |
| destroy | 幂等停止本实例输出，释放emit/aggregate引用；已运行回调继续结算，晚到结果不再取详情或记录 |

未新增事件白名单，R15-01目录仍是测试元数据。正文、路径和HTML的前端移除属于15.3；A04批次重放与50ms重试仍未修复，接收点15.4/15.7。Rust、冻结模型、依赖、数据格式、全部体积预算和旧67实际页面场景不变。

## 验证与替代映射

新增 `tests/stage-15-recorder.test.mjs` 22项：公共职责边界、envelope/双时钟、依赖验证、非法输入、开放category/status、聚合端口、实例隔离、幂等销毁、异步成功/失败晚到、销毁后调用、异常详情及非法时间。等待精确提交 Windows CI，不在本地执行产品功能测试、构建、浏览器或Rust。

R15-01原24项继续验证实际Runtime累计行为；测试VM仅剥离原Runtime安装语句，显式注入实际公共Recorder，不再通过旧源码重写其record/measure实现。残余VM服务旧聚合/diagnostic/transport/包装器定型，15.11清除。测试元数据原43个来源SHA保持，仅已迁移Runtime的历史指纹通过Git基线读取；新的静态公共边界契约验证当前实现唯一、实际Runtime接入。其余42来源仍核验当前SHA。

R12结构化字段断言改读实际Recorder，frontend envelope断言改读同一Owner；Rust frontend-to-native JSONL生产器注入实际公共工厂，继续通过真实 desktop adapter 和 Rust redaction/writer验证，不伪造payload。原批次、递归结构、秘密剔除、释放模式不写日志门禁保持。

生产清单552→554，新增两个真实模块；风险来源84→86，仅Runtime更新SHA并保留旧SHA迁移记录。全部七组Windows作业和原步骤保留，新增独立Recorder步骤与产物日志。

补充两个详情getter重入destroy的正常/聚合端口契约；Recorder在归一化完成后再次检查存活，防止取详情期间销毁后仍输出。

静态复核：公共职责1项、事件目录2项及迁移后的R12安全断言2项通过；7文件语法通过，22新项+24基线仅注册、不执行功能回调；86风险SHA、554生产模块、159相对链接及七组全部原步骤核对。功能、构建、浏览器与Rust均交新提交Windows CI，02尚未验收。
