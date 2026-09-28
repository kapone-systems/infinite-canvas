#!/usr/bin/env bash
# 在 WSL 里把源码同步到 $HOME/canvas-linux-build 再打 Linux 包。
# 不删除、不覆盖仓库里的 node_modules，也不改 apps/desktop/stage。
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../../.." && pwd)
dest="${HOME}/canvas-linux-build"
node_ver="v24.19.0"
node_name="node-${node_ver}-linux-x64"
archive="${node_name}.tar.xz"
appimage_name="CanvasApp-0.1.0-x86_64.AppImage"
deb_name="CanvasApp-0.1.0-amd64.deb"
setup_name="CanvasApp-Setup-0.1.0.exe"

die() {
  echo "$1" >&2
  exit 1
}

curl_retry() {
  local dest="$1"
  local url="$2"
  local attempt
  for attempt in 1 2 3 4 5; do
    if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 -o "$dest" "$url"; then
      return 0
    fi
    echo "下载失败（第 ${attempt} 次）：${url}" >&2
    sleep $((attempt * 2))
  done
  die "下载失败：${url}"
}

repo_real=$(realpath "$repo_root")
mkdir -p "$dest"
dest_real=$(realpath "$dest")
if [ "$dest_real" = "$repo_real" ] || [[ "$dest_real" == "$repo_real"/* ]]; then
  die "目的地不得是仓库本身：${dest_real}"
fi

electron_exe="$repo_root/node_modules/electron/dist/electron.exe"
[ -f "$electron_exe" ] || die "找不到本机仓库的 node_modules/electron/dist/electron.exe，停止。"
electron_size_before=$(stat -c '%s' "$electron_exe")
electron_sha_before=$(sha256sum "$electron_exe" | awk '{print $1}')

setup_exe="$repo_root/apps/desktop/release/${setup_name}"
[ -f "$setup_exe" ] || die "找不到原来的 ${setup_name}，停止。不打空的 Linux 包来代替它。"
setup_size_before=$(stat -c '%s' "$setup_exe")
setup_sha_before=$(sha256sum "$setup_exe" | awk '{print $1}')

# 只删副本里的旧依赖。realpath 一旦等于仓库就退出。
remove_inside_dest() {
  local target="$1"
  if [ ! -e "$target" ]; then
    return 0
  fi
  local real
  real=$(realpath "$target")
  if [ -d "$repo_root/node_modules" ]; then
    local repo_nm
    repo_nm=$(realpath "$repo_root/node_modules")
    if [ "$real" = "$repo_nm" ]; then
      die "拒绝删除或覆盖仓库 node_modules：${real}"
    fi
  fi
  case "$real" in
    "$dest_real"/*) rm -rf -- "$real" ;;
    *) die "拒绝删除目的地以外的路径：${real}" ;;
  esac
}

remove_inside_dest "$dest/node_modules"
remove_inside_dest "$dest/apps/desktop/release"
remove_inside_dest "$dest/apps/desktop/stage"
remove_inside_dest "$dest/apps/desktop/vendor"

rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude 'apps/desktop/release/' \
  --exclude 'apps/desktop/stage/' \
  --exclude 'apps/desktop/vendor/' \
  --exclude '.git/' \
  --exclude 'eval/' \
  --exclude '.tmp-*' \
  "$repo_root/" "$dest/"

work=$(mktemp -d)
fakeroot_dir=""
cleanup() {
  rm -rf "$work"
  if [ -n "$fakeroot_dir" ]; then
    rm -rf "$fakeroot_dir"
  fi
}
trap cleanup EXIT

curl_retry "$work/$archive" "https://nodejs.org/dist/${node_ver}/${archive}"
curl_retry "$work/SHASUMS256.txt" "https://nodejs.org/dist/${node_ver}/SHASUMS256.txt"
grep -F "$archive" "$work/SHASUMS256.txt" > "$work/${archive}.sha256line" || true
line_count=$(grep -c . "$work/${archive}.sha256line" || true)
if [ "$line_count" -ne 1 ]; then
  die "官方 SHA256 里 ${archive} 不是刚好一行（${line_count}），停止。"
fi

set +e
(
  cd "$work"
  sha256sum -c "${archive}.sha256line"
)
sha_status=$?
set -e
if [ "$sha_status" -ne 0 ]; then
  die "sha256sum -c 退出码 ${sha_status}，停止。不对整份 SHASUMS256.txt 做 -c，也不核对抽出的 node。"
fi
echo "sha256sum -c 退出码 0"

tar -xJf "$work/$archive" -C "$work"
node_bin="$work/$node_name/bin/node"
npm_bin="$work/$node_name/bin/npm"
[ -f "$node_bin" ] || die "压缩包里没有 ${node_name}/bin/node，停止。"
if [ ! -e "$npm_bin" ]; then
  die "压缩包里没有 npm，停止。不改用别的 Node。"
fi

vendor_node="$dest/apps/desktop/vendor/node/node"
mkdir -p "$(dirname "$vendor_node")"
cp -f "$node_bin" "$vendor_node"
chmod 0755 "$vendor_node"
[ -x "$vendor_node" ] || die "test -x 失败：${vendor_node}"
file_out=$(file "$vendor_node")
echo "$file_out"
case "$file_out" in
  *ELF*) ;;
  *) die "file 没有看到 ELF：${file_out}" ;;
esac

export PATH="$work/$node_name/bin:${PATH:-}"
hash -r
[ "$(realpath "$(command -v node)")" = "$(realpath "$node_bin")" ] || die "PATH 上的 node 不是官方压缩包里的 bin/node，停止。"
[ "$(realpath "$(command -v npm)")" = "$(realpath "$npm_bin")" ] || die "PATH 上的 npm 不是这份压缩包里的，停止。"
got=$("$node_bin" -p "process.version")
[ "$got" = "$node_ver" ] || die "Node 版本是 ${got}，不是 ${node_ver}，停止。"

cd "$dest"
ci_ok=0
for attempt in 1 2 3; do
  if npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000; then
    ci_ok=1
    break
  fi
  echo "npm ci 第 ${attempt} 次失败。清掉副本 node_modules 后再试。" >&2
  remove_inside_dest "$dest/node_modules"
done
if [ "$ci_ok" -ne 1 ]; then
  die "npm ci 失败，停止。不放空的安装包。"
fi

copy_nm=$(realpath "$dest/node_modules")
repo_nm=$(realpath "$repo_root/node_modules")
if [ "$copy_nm" = "$repo_nm" ]; then
  die "副本 node_modules 的 realpath 等于仓库，停止。"
fi
case "$copy_nm" in
  "$dest_real"/*) ;;
  *) die "副本 node_modules 不在 ${dest_real} 里：${copy_nm}" ;;
esac

npm run build -w @canvas/web
npm run build -w @canvas/desktop
[ -f "$dest/apps/web/dist/index.html" ] || die "缺少 apps/web/dist/index.html，停止。"
[ -f "$dest/apps/desktop/dist/main.js" ] || die "缺少 apps/desktop/dist/main.js，停止。"

# deb 需要 fakeroot。有免密 sudo 就装进系统；否则解到临时目录，不写 /usr，也不改仓库。
ensure_fakeroot() {
  if command -v fakeroot >/dev/null 2>&1; then
    return 0
  fi
  if sudo -n true >/dev/null 2>&1; then
    sudo -n apt-get update
    sudo -n apt-get install -y fakeroot dpkg
    return 0
  fi
  echo "没有免密 sudo，把 fakeroot 解到临时目录。" >&2
  fakeroot_dir=$(mktemp -d)
  (
    cd "$fakeroot_dir"
    apt-get download fakeroot libfakeroot
    mkdir -p root
    for deb in *.deb; do
      dpkg-deb -x "$deb" root
    done
  )
  local prefix="$fakeroot_dir/root"
  local lib="$prefix/usr/lib/x86_64-linux-gnu/libfakeroot/libfakeroot-tcp.so"
  local faked="$prefix/usr/bin/faked-tcp"
  local real="$prefix/usr/bin/fakeroot-tcp"
  if [ ! -f "$lib" ] || [ ! -x "$faked" ] || [ ! -f "$real" ]; then
    die "临时 fakeroot 不完整，停止。"
  fi
  mkdir -p "$fakeroot_dir/bin"
  cat > "$fakeroot_dir/bin/fakeroot" <<EOF
#!/bin/sh
exec $(printf '%q' "$real") -l $(printf '%q' "$lib") -f $(printf '%q' "$faked") "\$@"
EOF
  chmod 0755 "$fakeroot_dir/bin/fakeroot"
  export PATH="$fakeroot_dir/bin:${PATH}"
  hash -r
  command -v fakeroot >/dev/null 2>&1 || die "临时 fakeroot 不在 PATH 上，停止。"
}

ensure_fakeroot

# WSL 经常没有 /dev/fuse。appimagetool 自身是 AppImage 时，这个变量让它解压后运行，用来打出真正的 AppImage，不是空文件。
if [ ! -e /dev/fuse ]; then
  export APPIMAGE_EXTRACT_AND_RUN=1
fi

npm run dist:linux -w @canvas/desktop

appimage="$dest/apps/desktop/release/${appimage_name}"
deb="$dest/apps/desktop/release/${deb_name}"
if [ ! -s "$appimage" ] || [ ! -s "$deb" ]; then
  die "没有打出两个非空安装包，停止。不往仓库里放空文件。"
fi
pkg=$(dpkg-deb -f "$deb" Package)
arch=$(dpkg-deb -f "$deb" Architecture)
if [ "$pkg" != "canvas-app" ] || [ "$arch" != "amd64" ]; then
  die "deb 控制字段不对：Package=${pkg} Architecture=${arch}"
fi

mkdir -p "$repo_root/apps/desktop/release"
cp -f "$appimage" "$deb" "$repo_root/apps/desktop/release/"

for f in \
  "$repo_root/apps/desktop/release/${appimage_name}" \
  "$repo_root/apps/desktop/release/${deb_name}" \
  "$setup_exe"
do
  [ -s "$f" ] || die "缺少成品：${f}"
done

setup_size_after=$(stat -c '%s' "$setup_exe")
setup_sha_after=$(sha256sum "$setup_exe" | awk '{print $1}')
if [ "$setup_size_before" != "$setup_size_after" ] || [ "$setup_sha_before" != "$setup_sha_after" ]; then
  die "原来的 ${setup_name} 被改动，停止。"
fi

electron_size_after=$(stat -c '%s' "$electron_exe")
electron_sha_after=$(sha256sum "$electron_exe" | awk '{print $1}')
if [ "$electron_size_before" != "$electron_size_after" ] || [ "$electron_sha_before" != "$electron_sha_after" ]; then
  die "仓库 node_modules/electron/dist/electron.exe 被改动，停止。"
fi
echo "electron.exe 大小 ${electron_size_after} SHA256 ${electron_sha_after} 与打包前一致"
echo "已拷回 ${appimage_name} 与 ${deb_name}，未删除 apps/desktop/release"
