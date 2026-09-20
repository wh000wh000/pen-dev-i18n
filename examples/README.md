# 示例

## Pen（pencil.dev）

仓库已经带了现成预设，一条命令就能用：

```bash
node ../../bin/zh-patch.mjs preset use pen --dir ~/pen-zh
cd ~/pen-zh
node <repo>/bin/zh-patch.mjs start
```

## 给一个新 App 做汉化（完整过程）

以虚构的 `Acme.app` 为例：

```bash
R=/path/to/zh-patch
N="node $R/bin/zh-patch.mjs"
mkdir -p ~/acme-zh && cd ~/acme-zh

# 1) 生成配置（自动探测 Electron 与进程名）
$N init --app "/Applications/Acme.app"

# 2) 启动并注入（此时词典是空的，界面看起来还是英文）
$N start --daemon

# 3) 抓取当前界面所有可见 UI 字符串
$N extract --out strings.json

# 4) 拿未翻译清单
$N todo --write todo.json
#   todo.json.strings = ["New Project", "Import…", ...]

# 5) 翻译后合并（示例见 ./sample-translation.json）
$N dict merge examples/sample-translation.json

# 6) 验收
$N verify --min 90
```

一份最小的翻译文件长这样：

```json
{
  "New Project": "新建项目",
  "Import…": "导入…",
  "Export Selection to...": "导出选区为…"
}
```

## 动态文案（含变量）

词典只做精确匹配，带变量的文案请写进 `zh-patch.config.json`：

```json
{
  "engine": {
    "rules": [
      ["^(\\\\d+) files?$", "$1 个文件"],
      ["^Thought for (.+)$", "思考了 $1"]
    ]
  }
}
```

规则是 `[正则字符串, 替换模板]`，`$1` 保留捕获组；项目自带的通用规则已经覆盖了相对时间、`N models`、`Step N` 这类常见形态。
