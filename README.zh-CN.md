# agent-method-registry

[English](README.md)

用于代理方法目录解析、提供者验证和 CLI 诊断的确定性注册表。

`agent-method-registry` 帮助代理编码项目维护方法（技能/工作流）的规范目录，通过文件系统验证解析提供者，并诊断注册表健康状况。它设计用于 CLI 工具、Node 库和 CI 流水线的确定性本地使用。

## 安装

```bash
npm install agent-method-registry
```

需要 Node.js `>=22.0.0`。

## 快速开始

```javascript
import {
  validateCatalog,
  validateProjectOverlay,
  buildEffectiveIndex,
  queryEffectiveIndex,
  resolveEntry,
  verifyProvider,
  diagnoseRegistry,
} from 'agent-method-registry';
```

## 公开 API

包暴露恰好 **7 个函数**加 `ERROR_CODES` 和领域类型：

| 函数 | 用途 |
|------|------|
| `validateCatalog` | 根据 schema 验证目录 YAML/JSON |
| `validateProjectOverlay` | 验证项目覆盖层（覆盖、禁用） |
| `buildEffectiveIndex` | 从目录 + 覆盖层构建合并的确定性有效索引 |
| `queryEffectiveIndex` | 使用过滤器查询有效索引（领域、意图、类型） |
| `resolveEntry` | 解析特定条目并进行提供者文件系统验证 |
| `verifyProvider` | 验证提供者的 SKILL.md 是否存在于文件系统中 |
| `diagnoseRegistry` | 运行全面的注册表健康检查（schema、合并、新鲜度、提供者） |

## CLI

```bash
# 验证目录文件
agent-method-registry validate --catalog catalog.yaml --project overlay.yaml

# 构建有效索引
agent-method-registry index --catalog catalog.yaml --out index.json

# 查询索引
agent-method-registry query --index index.json
agent-method-registry query --index index.json --domain artifact --kind workflow

# 解析特定条目
agent-method-registry resolve --index index.json --ref my-plugin.entity.author --host claude-code --plugin-root ./plugins/my-plugin
```

所有 CLI 命令向 stdout 输出单个 JSON 信封：

```json
{
  "ok": true,
  "data": { "..." },
  "diagnostics": []
}
```

退出码：`0` = 成功，`1` = 数据/索引/条目错误，`2` = 格式错误的调用。

## 许可证

[Apache-2.0](LICENSE)

参见 [NOTICE](NOTICE) 了解归属信息。
