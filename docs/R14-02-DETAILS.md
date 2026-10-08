# R14-02 导出请求标准化

状态：**R14-02已通过精确提交七组Windows CI并收尾**。验收提交 `b85f74cfa6766407de3f72b193a349e87e7f606f` / [CI37807608820](https://github.com/uniquenesssta/mdr/actions/runs/37807608820)。唯一分支 `agent/r14-stage`；前置14.1 `7d0fd6a` / CI37801667677的验收保持。2026-10-09用户要求“收尾02开始03”，继续同分支实施 [R14-03](R14-03-DETAILS.md)。

## 正式Windows验收（2026-10-09）

全部七组与执行步骤成功；日志明确同提交Windows证据汇总通过。全仓16目录1686/1686、前端688/688、请求专项31/31、原导出基线41/41、契约浏览器11/11、实际built-app浏览器34/34。真实WebView、Rust、原生编译链接、官方依赖硬门禁通过。

| Windows组 | Job ID | 结果 |
| --- | --- | --- |
| 全仓递归Node | 113415876340 | success |
| 前端、构建、浏览器与静态门禁 | 113415876265 | success |
| Rust累计硬门禁 | 113415875809 | success |
| 原生编译与链接 | 113415876237 | success |
| 官方RustSec与Windows依赖图 | 113415876120 | success |
| 真实Windows WebView | 113415876148 | success |
| 同提交证据汇总 | 113419235834 | success |

[汇总产物](https://github.com/uniquenesssta/mdr/actions/runs/37807608820/artifacts/11563059984) ID11563059984，SHA-256 `61e0db86a7f4e52fa12a058ce59601b9870617c6437fa1629c19bb4825f8d943`；[WebView产物](https://github.com/uniquenesssta/mdr/actions/runs/37807608820/artifacts/11563508897) ID11563508897，SHA-256 `fea4806b3d42c0229232b4d3a8baa6e330f6ff2d731857a774c3bd1c3790d2cc`。请求标准化和前置校验验收不等于四种渲染格式已修复；F01/F02/F04与A10继续保持，F03完整格式产物仍须后续验证。


## 请求职责与实际接入

`src/features/export/application/export-request.js`唯一拥有请求校验、文件名/扩展名策略和五组图片比例元数据。公共入口为`src/features/export/index.js`；纯函数`createExportRequest`返回深度冻结的普通数据，不读取内容、DOM、模型、平台或任务状态。

| 字段 | 契约 |
| --- | --- |
| format | 仅markdown/html/word/pdf/image，去首尾空格并转小写，其他值抛明确校验错误 |
| documentId | 非空字符串；保留历史身份原值，不trim或重写；实例端口另核对当前Documents中实际存在 |
| name | 独立文件名；空白回退未命名文档；保留目标格式已接受后缀；其他已知格式后缀替换，未知后缀保留并追加目标扩展名 |
| directory | 文本去首尾空格，空串继续用默认目录；拒绝非文本与控制字符；不探测路径、创建目录或替代平台路径/写入验证 |
| extension/extensions | 固定格式元数据；Markdown仍接受md/markdown，HTML仍接受html/htm，Word仍为doc |
| imageOptions | 仅图片格式可传；比例必须属于现有五组，裁切为布尔值；输出固定ratio/width/height/cropFit，输入后续改动不能改变请求 |

文件名统一将Windows不可用标点转为下划线，去尾部空格/点，对设备保留名加下划线前缀，并拒绝控制字符与超过255个UTF-16单元的结果。该策略只作用于导出副本，原文档标题、身份和持久化记录不改。

`src/main.js`挂载明确的Export Request端口，只注入Documents只读身份与存在检查，在pagehide卸载。`compatibility/classic-export-request-port.js`只拥有挂载生命周期，不复制文档、任务、预览或进度状态；销毁后拒绝新调用，重复挂载失败。该临时端口随14.18旧导出调用者移除，不作为最终Export Controller替代品。

当前菜单Markdown/HTML/Word/PDF、图片预览和图片下载全部先取得有效请求，再启动任务、读取快照、加载图片库、打印或写文件。右键导出在读目标内容前验证该文档；不存在的明确ID不再回退导出当前文档。HTML/Word保存名称与目录、图片比例与裁切在异步准备前固定；原有取消、任务互斥、进度、版本、写入失败与上下文generation检查保留。

删除classic导出中的格式文件名正则和浏览器Markdown后缀策略，原五组图片比例常量迁至请求唯一所有者。现存classic格式实现只收集UI输入并消费标准请求，后续任务/内容/增强/文件写入仍按各自Atomic迁移。

## 旧契约到新契约的对应

14.1 `contracts.json`全文与原始输入保留，新增`requests.json`记录本次明确的名称变化，不覆盖历史基线或降低场景数量。

| 原目的或行为 | 14.2替代断言 | 保留场景 |
| --- | --- | --- |
| 原浏览器report.txt.md、report.html.md，桌面对话框原始txt/html名称 | 桌面与浏览器均消费report.md；已知错误后缀在请求边界替换 | 六组名称、UTF-8原文字节、对象URL释放、保存过滤器/目录与写入参数 |
| HTML/Word给非Markdown名称再次追加后缀 | report.txt/report.html统一映射report.html/report.doc；合法目标后缀与大小写保留 | HTML/Word转义、完整模板及单次写入，取消/失败不回退浏览器 |
| 尖括号名称在浏览器原样，桌面平台另清理 | Export Request先映射A&B _title_，HTML标题继续转义& | 名称特殊字符、安全标题输出；不改源文档名 |
| 图片比例常量及晚读取crop状态 | 请求拥有相同比例值并冻结裁切/尺寸 | 五种比例、自然高度、裁切、PNG编码与不可取消阶段 |
| 上下文未知ID回退当前文档 | 明确失败，不读取/写入其他文档；有效目标仍导出其实际内容 | 非当前目标、异步期间改名/改目录、generation过时拒绝 |
| 新请求校验 | 明确format/documentId/name/directory/imageOptions字段错误；所有入口在任务前拒绝 | 未创建进度、无模型快照/库加载/打印/保存/晚到产物，实例卸载与历史ID兼容 |

F03的当前入口命名策略已迁移并通过本次Windows验证；原格式重写项14.9/14.10/14.11仍须保留这些映射并验收真实完整产物。F01、F02、F04和A10继续未修复：HTML/Word/PDF/Image仍受已退休预览变量阻断，旧增强/CDN独立页问题未借本项修复。PDF名称只是请求元数据，本项不宣称输出真实PDF或修复打印恢复。A10处置截止仍是14.7验收前，阶段末完整离线链不能遗留。

## 验证与边界

新增`tests/stage-14-export-request.test.mjs`验证五格式矩阵、合法后缀/Unicode/Windows名称、深度不可变与身份保留、五比例、无效字段、文档存在和端口生命周期；通过实际classic代码加真实请求端口验证全部入口前置失败、长文期间名称/目录快照、图片裁切快照及右键目标/过时行为。14.1的隔离DOM/平台替身仍只证明编排算法，不冒充原生I/O或渲染产物。

实际built-app继续验证原文与六组名称、四格式真实断链、长文缺口、锁定数学/Mermaid和可解码PNG正控，并新增真实请求不可变/错误字段/无任务、打印与下载副作用检查；产物为`r14-02-text-exports.json`和`r14-02-request-validation.json`。不把纯函数或VM替身当成实际导出格式成功。

复用唯一七组Windows流程，新增定向请求步骤；全仓递归Node、前端、构建、契约/实际浏览器、Rust、官方依赖、真实WebView、原生与最终同提交硬门禁全部保留。生产所有权清单补齐三个新模块，累计风险源指纹同步更新；历史R12验收/源证据及模型冻结契约不改。

本地11个变更脚本、5个嵌入浏览器表达式语法、四项静态门禁、相对链接、39项风险源指纹、原始格式基线与历史验收/diff复核通过；不在Linux/macOS执行产品测试或构建。上述实现已由本提交Windows实际行为与累计结果验证，14.2已勾选；下述启动约定为实施时记录。启动Actions后结束会话，不轮询，约15～20分钟后查询。

使用Mermaid Chart记录真实请求→校验→当前导出链。无新依赖、第三方API、Rust命令或存储格式变更；回退限本项请求模块、调用者接入及对应测试/文档，不回退14.1验收。
