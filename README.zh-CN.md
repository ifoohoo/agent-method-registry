# agent-method-registry

[English](README.md)

`agent-method-registry` 是面向智能体工程的本地确定性方法注册与核验工具。当多个技能插件与项目本地目录同时提供写作、评审、测试或发布工作流时，调用方不必在脚本里写死某个插件路径，只需按稳定的逻辑方法名向注册表查询或解析，即可在严格校验目录契约、项目覆盖、宿主身份与文件树摘要的前提下拿到唯一可信入口。

## 核心能力与协议分层

本包同时维护两代互补协议，公开包根始终锁定为 **7 个函数 + `ERROR_CODES`**，不因能力演进膨胀导出面：

- **v1 目录与覆盖协议**：面向轻量级跨插件方法分发（如 `humanize-rewrite`）。支持多插件目录（`catalog`）合并、项目级覆盖与显式停用（`agent-methods.yaml`）、按领域/制品/意图检索、多宿主 `SKILL.md` 物理路径核验，以及单项目能力安全解绑（`unbind`）。
- **v2 技能族 SPI 与运行锁协议（自 `0.2.0` 起正式提供）**：面向多服务技能族的严密契约治理。将“Family API 契约 → 实现描述符（`v2-implementation`）→ 可信宿主安装清单（`v2-inventory`）→ 能力投影（`v2-projection`）→ 项目显式绑定（`v2-binding`）→ 标准方法查询（`Method Query`）→ 16 字段运行锁（`v2-run-lock`）”串联为单向可验证链路。

## 为什么采用严密的显式绑定与运行锁

在实际多插件协作中，“磁盘上装了某个技能”远不代表“当前项目允许在当前宿主下直接调用它”。注册表在设计上坚持三条硬边界：

1. **六维状态正交，拒绝隐式兜底**：安装（`INSTALLED`）、启用（`ENABLED`）、契约兼容（`COMPATIBLE`）、物理可信（`VERIFIED`）、解析唯一（`EXPLICIT_BINDING`）与项目绑定来源（`project-binding`）彼此独立。零个或多个合格候选一律报错阻断（fail-closed），绝不按“列表第一项”“最高版本号”或未声明的内置回退私自替用户做主。
2. **统一可执行判别字 `executable`**：v2 推荐查询返回的每条记录都带有布尔字段 `executable`，由与 `prepare` 完全相同的六态门禁函数派生。`where-am-i` 等路由入口只需直接读取 `executable`，无需也不允许在外部重复拼装状态判断；仅安装而未显式绑定的唯一兼容候选（`UNIQUE_COMPATIBLE`）会如实展示在推荐列表中，但 `executable` 恒为 `false`。
3. **多宿主身份隔离与执行前复验**：统一支持 `codex`、`claude-code`（兼容宿主别名 `claude`）、`antigravity`（兼容 `antigravity-ide` 与官方 CLI `agy`，原生覆盖 `.agents/skills`、`.agent/skills`、`~/.gemini/config/skills` 与 `~/.gemini/config/plugins/*/skills`）、`kimi`（兼容 Foundation 宿主标识 `kimi-code` 互认）、`qoder`、`codebuddy`、`workbuddy`、`grok`、`cursor` 与 `deepseek-harness`（兼容别名 `dsh`）。运行锁将宿主身份与技能文件树摘要一并封存；真正执行前调用 `verifyProvider` 复验，一旦跨宿主混用或磁盘文件发生篡改，立即返回 `HOST_MISMATCH` 或 `BUNDLE_DIGEST_MISMATCH`。

### 技能族命名空间分类

注册表按前缀确定性区分三类 Family API 与服务身份，并核对整条链路上的项目归属一致性：

```text
STANDARD     artifact.<family>-family              → artifact.<family>.<service>
THIRD_PARTY  <reverse-domain>.<family>-family      → <reverse-domain>.<family>.<service>
PROJECT      project.<authority>.<family>-family   → project.<authority>.<family>.<service>
             （项目私有实现须全程携带一致的 projectAuthority = project.<authority>）
```

历史文档中服务名保留 `-family` 段（如 `artifact.<family>-family.<service>`）的写法继续兼容，新建实现统一采用去后缀的规范形式。命名空间分类用于校验结构与归属自洽，第三方域名所有权与项目权威签发由外部证明协议独立负责。

## 安装与环境要求

运行环境要求 Node.js `>=22.0.0`。

```bash
npm install agent-method-registry
```

## 公开 API（7 个根函数）

```javascript
import {
  validateCatalog,
  validateProjectOverlay,
  buildEffectiveIndex,
  queryEffectiveIndex,
  resolveEntry,
  verifyProvider,
  diagnoseRegistry,
  ERROR_CODES,
} from 'agent-method-registry';
```

| 函数 | 职责边界 |
|------|----------|
| `validateCatalog` | 校验 v1 插件目录，或带显式 `documentKind` 的 v2 实现描述符、安装清单、运行锁与迁移计划 |
| `validateProjectOverlay` | 校验 v1 项目覆盖配置（`agent-methods.yaml`），或 v2 项目绑定与能力投影文档 |
| `buildEffectiveIndex` | 构建确定性 v1 有效索引，或从候选安装事实与绑定生成 v2 能力投影及 `preparedInventory` |
| `queryEffectiveIndex` | 按过滤条件查询 v1 索引；或在 v2 下执行只读推荐（`recommendation`）与签发进程内 `preparedQueryHandle`（`prepare`） |
| `resolveEntry` | 解析 v1 方法入口并核验宿主根目录，或凭 `preparedQueryHandle` 执行 v2 严格解析并签发 `runMethodLock` |
| `verifyProvider` | 对照真实文件系统核验 v1 `SKILL.md` 路径，或复验 v2 安装实例与运行锁的文件树摘要、软链接边界及宿主身份 |
| `diagnoseRegistry` | 诊断目录、合并、新鲜度、提供方与 v2 投影健康度；通过 `mode: 'professional-scan' \| 'read-proof'` 兼任专业证明扫描与只读核验 |

公开 JSON Schema 可通过子路径直接引用（如 `agent-method-registry/schemas/inventory.schema.json`），包根保持 7 函数不变。
### 专业证明扫描与只读核验

不传 `mode` 时，`diagnoseRegistry` 执行常规同步诊断；显式指定 `mode` 时复用同一入口完成 Foundation 专业结论对象（`skill-family.professional-conclusion`）的生成与核验：

```javascript
const scanned = diagnoseRegistry({
  mode: 'professional-scan',
  subject: { ref: 'my-registry' },
  request: { catalogs: [catalogData] }, // 仅检查显式传入的输入，不会扫描未知目录
});

const read = diagnoseRegistry({
  mode: 'read-proof',
  proof: scanned.conclusion,
  expectedProviderId: 'agent-method-registry',
});
```

`professional-scan` 的 `conclusion.outcome.code` 取值为：
- `REGISTRY_CLEAR`：声明范围内的适用检查全部完成且无异常；
- `REGISTRY_FINDINGS`：存在校验或核验错误；
- `REGISTRY_CHECK_INCOMPLETE`：虽无报错，但部分必检项因缺少索引、宿主或根路径而处于 `unverified`；
- `REGISTRY_CHECK_UNAVAILABLE`：输入请求不满足扫描前提。

`read-proof` 只解析并核对既有证明对象本身，不读取外部目录、不重跑扫描，返回 `status: "pass" | "not_pass" | "unavailable"`。

## 命令行用法（CLI）

```bash
# 1. 查看只读帮助与受支持宿主列表
agent-method-registry --help

# 2. 校验插件目录与项目覆盖配置
agent-method-registry validate --catalog catalog.yaml --project agent-methods.yaml

# 3. 构建有效索引并按条件查询
agent-method-registry index --catalog catalog.yaml --project agent-methods.yaml --out index.json
agent-method-registry query --index index.json --domain zh-CN --intent rewrite

# 4. 按目标宿主解析方法入口（支持 codex / claude-code［兼容 claude］/ antigravity / kimi［兼容 kimi-code］/ qoder / codebuddy / workbuddy / grok / cursor / deepseek-harness［兼容 dsh］）
agent-method-registry resolve --index index.json --ref humanize-rewrite \
  --host antigravity --plugin-root /absolute/plugin/path

# 5. 在单个项目中安全解绑某个方法覆盖或绑定（校验剩余配置合法、清理悬空引用，重复执行幂等）
agent-method-registry unbind humanize-rewrite --project agent-methods.yaml --catalog catalog.yaml

# 6. 预览 v1→v2 迁移计划（apply 前须人工核对映射与冲突报告）
agent-method-registry migrate --catalog catalog.yaml --project agent-methods.yaml \
  --migration-context migration-context.json --dry-run --out-plan migration-plan.json --transaction-root .

# 7. 执行专业扫描并排他写入证明文件，随后只读核验该证明
agent-method-registry diagnose --mode professional-scan \
  --input-root . --input diagnose-request.json --subject my-registry \
  --conclusion-output /absolute/path/conclusion.json
agent-method-registry diagnose --mode read-proof --proof-root . --proof conclusion.json
```

所有 CLI 子命令均在标准输出返回单行结构化 JSON 信封 `{ "ok": boolean, "data": ..., "diagnostics": [...] }`：
- 退出码 `0`：执行成功（含 `query` 无匹配记录及 `unbind` 目标原本未绑定的幂等成功）；
- 退出码 `1`：配置校验失败、提供方缺失/冲突、发现漂移或证明未通过（`not_pass`）；
- 退出码 `2`：命令行参数缺失、未知标志或无法解析的外部证明。

## 安全与写入边界

<!-- release-skill:capability:safe-first-command -->
首次验证安装时，可直接运行 `agent-method-registry --help`：该命令完全只读，不写入任何文件，也不触发网络请求。`validate`、`query`、`resolve` 与不带输出参数的 `diagnose` 仅读取命令行显式传入的文件，绝不执行目录中登记的任何外部技能脚本。

<!-- release-skill:capability:external-write-boundary -->
外部写入边界：本包完全在本地确定性运行，零网络调用、零远端状态变更。仅当命令行显式传入以下参数时才会在本地落盘：`index --out`（写出有效索引）、`unbind`（在不带 `--dry-run` 时更新指定的项目配置或清理已清空的 v2 绑定文件）、`diagnose --conclusion-output`（排他新建证明文件，绝不覆盖已有文件），以及限定在 `--transaction-root` 目录树内的 `migrate --out-plan` / `--apply` / `--rollback`。

## 许可证

[Apache-2.0](LICENSE)

本项目由广州市风荷科技有限公司与 `agent-method-registry` 贡献者共同维护，归属声明见 [NOTICE](NOTICE)。
