# 无限画布

本机无限画布。窗口是 Electron，后端是随安装包带上的 Node，只听 `127.0.0.1`。

## 给要直接使用的人

到 [Releases](https://github.com/kapone-systems/infinite-canvas/releases) 下载安装包。

- Windows：`CanvasApp-Setup-0.1.3.exe`。0.1.2 的设置页没有「远程电脑」，请改下这一版。安装后从开始菜单打开「无限画布」。
- Linux x64：仍是上一版 `CanvasApp-0.1.0-x86_64.AppImage` 或 `CanvasApp-0.1.0-amd64.deb`。这台 Windows 打不出 AppImage。AppImage 先 `chmod +x` 再运行。deb 的包名是 `canvas-app`，窗口名仍是「无限画布」。Linux 上还不能把厂商密钥写进系统凭据库。远程电脑的 SSH 密码或私钥也只在 Windows 凭据库里保存，所以这一版的远程连接请用 Windows 安装包。

打开后点「新建工程」，粘贴一个文件夹路径并填写工程名。工程文件在你选的文件夹里，可以整夹拷走。

文生图、图生图默认仍是替身出图。设置里可以填本机 ComfyUI 地址，也可以用「远程电脑」经 SSH 把远端 ComfyUI 转到本机 `127.0.0.1`。要让运行走真 ComfyUI 而不是替身，再打开「使用本机 ComfyUI」。这一步的报文还没有对照远端版本核实，不能当成已经能出图。图生视频是夹具，不是某一家云厂商。文生文、文生视频、对口型还不能运行。没有 ffmpeg 时，视频只能留原片，做不出封面和预览。

## 给要改代码的人

需要 Node.js 24。在仓库根目录：

```bash
npm install
npm run build -w @canvas/web
npm run build -w @canvas/desktop
npm run start -w @canvas/desktop
```

只开浏览器：

```bash
npm run start -w @canvas/backend
```

用终端打印的 `http://127.0.0.1:<端口>/#token=` 打开。
