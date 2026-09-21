#!/usr/bin/env bash
# Pen 汉化补丁 · 一键安装
#
#   ./install.sh              安装到 ~/Pen汉化 并生成双击启动器
#   ./install.sh --start      装完立刻带汉化启动 Pen
#   ./install.sh --dir <目录> 装到指定目录
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$HOME/Pen汉化"
START=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --start) START=1; shift ;;
    --dir) TARGET="$2"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

say "Pen 汉化补丁 · 安装程序"
say ""

# 1) 依赖检查
command -v node >/dev/null 2>&1 || die "没找到 Node.js。请先安装：https://nodejs.org （装完重新运行本脚本）"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 20 ]] || die "Node.js 版本过低（当前 v$(node -v | tr -d v)，需要 20+）"
ok "Node.js $(node -v)"

[[ -f "$HERE/bin/zh-patch.mjs" ]] || die "这个脚本必须放在仓库根目录里运行（找不到 bin/zh-patch.mjs）"
[[ -d "/Applications/Pen.app" ]] || warn "没在 /Applications 找到 Pen.app —— 装完后如果启动失败，请把 Pen 装到应用程序目录"

# 2) 建目录、装配置与词典
mkdir -p "$TARGET"
ok "安装目录：$TARGET"

node "$HERE/bin/zh-patch.mjs" preset use pen --dir "$TARGET" >/dev/null
LANGS=$(ls "$TARGET/dict" 2>/dev/null | wc -l | tr -d ' ')
ok "已装好配置与 $LANGS 个语言词典"

node "$HERE/bin/zh-patch.mjs" install-launcher --dir "$TARGET" >/dev/null
ok "已生成双击启动器：启动 Pen 汉化.command"

# 3) 写一个「顺手能跑的」包装脚本，避免用户记长路径
cat > "$TARGET/pen-zh" <<WRAP
#!/usr/bin/env bash
# 快捷入口：pen-zh start|stop|status|verify|lang use ja ...
exec node "$HERE/bin/zh-patch.mjs" "\$@"
WRAP
chmod +x "$TARGET/pen-zh"

say ""
say "— 装好了 —"
say ""
say "以后启动汉化版 Pen："
say "  双击   $TARGET/启动 Pen 汉化.command"
say ""
say "想在终端里用："
say "  cd \"$TARGET\" && ./pen-zh start        # 启动并汉化（Ctrl+C 退出）"
say "  cd \"$TARGET\" && ./pen-zh start --daemon   # 后台常驻"
say "  cd \"$TARGET\" && ./pen-zh lang use ja      # 换成日语"
say "  cd \"$TARGET\" && ./pen-zh stop --restart   # 停用并恢复原版"
say ""
warn "注意：汉化版必须由启动器打开；直接点 Dock 图标开的是原版英文。"

if [[ "$START" == "1" ]]; then
  say ""
  if pgrep -f "Pen.app/Contents/MacOS/Pen" >/dev/null 2>&1; then
    warn "Pen 正在运行 —— 请先 Cmd+Q 退出，然后再双击启动器。"
  else
    cd "$TARGET" && ./pen-zh start
  fi
fi
