# 无限画布

本机无限画布。窗口是 Electron，后端是随安装包带上的 Node，只听 `127.0.0.1`。

## 给要直接使用的人

到 [Releases](https://github.com/kapone-systems/infinite-canvas/releases) 下载 `CanvasApp-Setup-0.1.0.exe`，安装后从开始菜单打开「无限画布」。

打开后点「新建工程」，粘贴一个文件夹路径并填写工程名。工程文件在你选的文件夹里，可以整夹拷走。

文生图、图生图目前是替身出图，不是连上你自己的模型。设置里要填一个能访问的本机 ComfyUI 地址，检查通过后大约 8 秒出一张小图。图生视频是夹具，不是某一家云厂商。文生文、文生视频、对口型还不能运行。没有 ffmpeg 时，视频只能留原片，做不出封面和预览。

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
