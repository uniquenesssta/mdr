# R15-03 前端脱敏

唯一分支 `agent/r15-stage`，基线 R15-02 的 f56a50a / CI38370285145。02七组Windows及全部步骤通过：Recorder22、事件目录24、全仓2259、前端1252、浏览器11+67、Rust281；三份下载归档摘要与最终同提交accepted=true核验，正式收尾。03已实施，等待新提交Windows验收；15.4未开始，A04仍未修复。

## 当前职责

公共入口 `src/features/telemetry/index.js` 提供 Recorder 和纯脱敏能力，`telemetry-redaction.js` 唯一拥有前端隐私规则；Recorder 原有结构保护实现已迁入该规则，不维护两份副本。

| 输入边界 | 当前输出 |
| --- | --- |
| 嵌套正文/HTML/Markdown/text与认证字段 | 移除字段，不访问被排除的正文getter |
| 完整路径、filename/file/directory/path/paths | 移除字段；hasDocumentPath等布尔存在标志保留且getter只读一次 |
| 普通字符串、错误/message/stack、未知字段下HTML/Data URL/完整路径 | `[redacted]`，不通过字符串截断留下正文前缀 |
| JSON和双重编码JSON | 16K字符内先解析，再递归过滤；非法/过大输入闭合为marker |
| 数值/布尔/空值指标 | 保留；非有限数字null、unsupported值省略 |
| 明确枚举 | MIME、side/mode/status/origin/extension只有代码中明确的值保留，未知字符串闭合 |
| operation/category/status | 保留受限代码标识符，自定义代码名称保持；路径、URL、HTML及自由文本闭合 |
| sessionId | 构造时要求受限代码标识符，拒绝路径/自由文本 |
| diagnostic dedupe/fingerprint、flush错误去重 | 原有长度归一化后只保留双32位opaque identity；不把原始路径/错误文本留在该状态或flush警告 |

继续保留原深度8、512节点、对象64键、数组20界限与循环/异常保护。安全键名限定64字符字母/数字/下划线/连字符；null prototype输出避免prototype-shaped键触发继承的枚举方法。marker重复过滤保持稳定。

普通record、createEntry、measure异常、diagnostic、聚合入口及聚合读回均走同一规则。聚合端口仅收规范化category/status、数值duration、aggregate和脱敏details，不再转发未知原始options。实际Runtime的去重hint和flush错误缓存使用opaque identity，保留正常相等/变化语义；散列存在理论碰撞且不是密码学匿名化，不作为授权、密钥或安全身份机制。

本项针对遥测缓冲和输出的数据最小化，不更改用户文档、文件名或应用错误身份。代码形状标识符的语义来自调用者，不声称可识别伪装成合法标识符的正文。Rust生产redaction/writer、冻结模型、原生命令、依赖、格式及所有体积门槛保持。A04的partial-write acknowledgement、无限重放与50ms重试不在本项宣称解决。

## 验证及旧断言映射

新增33项独立契约：隐私字段递归、路径/HTML/DataURL/任意文本、双编码、异常JSON、指标/枚举、私有getter、prototype-shaped键、循环和深度边界、重复过滤、两个端口、envelope限制、hint变化、真实Runtime diagnostic/aggregate/measure链，以及布尔getter重入和duration对象规范化。现有真实frontend-to-desktop生产器新增1项原始secret提前消失断言，共34新增Node契约。

原R15-01“正文保留至Rust”定型断言改为缓冲前已删除body，同时继续检查嵌套、数组、循环、BigInt和非有限值；其余23项、R15-02全部22项保留。R12结构化字段断言改读单一新规则；保持结构化，不将嵌套转为JSON字符串。Rust实际pipeline的4个basename断言改为路径字段已无，再同时核验真实frontend入参和最终JSONL无原始/转义secret；count、3条entry、测量、异常链、数组、编码JSON及实际command/writer全部保留。Rust独立14项redaction测试和既有release不写日志门禁不变。

历史目录43来源与原始SHA保持，已迁移Runtime仍从既有Git基线核对；当前脱敏Owner与接入由新公共边界测试及精确风险SHA验证。生产模块554→555，风险来源86→89；七组Windows全部原步骤及旧67实际页面场景保留，新增专项产物telemetry-redaction.log。

本地仅静态边界、来源、文档、语法和测试注册验证；不执行产品功能、构建、浏览器或Rust，全部功能交新提交Windows CI。03尚未验收。

静态结果：四项门禁、6项当前职责/历史安全/目录断言、10文件语法通过；82回调仅注册（33新增专项、3实际payload、22Recorder、24基线），本地产品回调执行0。89风险SHA、555生产模块、157相对链接、七组全部旧步骤、Rust生产/模型/依赖/体积门槛与67实际场景均复核；完整功能等待本次Windows CI。
