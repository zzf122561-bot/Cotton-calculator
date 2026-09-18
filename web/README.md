# 皮棉成本换算桌面网页版

这是“皮棉成本换算”的电脑端静态网页实现。它不含后端、分析、广告、第三方 CDN 或运行时依赖。手摘棉和机采棉分别保存输入、计算方向和明细展开状态。

> 维护范围：自 2026-09-06 起只维护电脑端。iOS/iPadOS、手机主屏幕安装、Web Clip 配置和手机端适配不再维护，也不作为后续版本验收范围。

## 功能

- 籽棉价格与皮棉入库成本双向换算；只有实际修改价格才切换计算依据。
- 衣分率、损耗率、棉籽价格、加工费、人工费、入库费、财务费和补贴可编辑。
- 明细展示棉籽产出率、棉籽抵扣、净籽棉成本、皮棉原料成本、费用净额和最终成本。
- 页头使用内置生图生成的手绘棉花；“使用说明”包含四张真实手机视口截图及框线、箭头说明。
- 默认采用黑白银主题，也可切换黑白金或自选强调色；主题单独保存在 `cottoncal.theme.v1`。
- “复制测算摘要”与“发邮件询价”会带上当前棉种、计算依据和测算结果，方便继续补充数量、质量指标、交货地与账期。
- 使用 BigInt 有理数完成精确业务计算，只在显示时采用 `HALF_UP` 四舍五入。
- `localStorage` 键固定为 `cottoncal.pwa.v1`；损坏或缺失数据会安全回退。
- 支持系统深浅色和常见电脑浏览器窗口尺寸。
- 首次联网（或本机 HTTP）成功打开后，Service Worker 预缓存全部应用资源，可离线刷新。

## 本地启动

需要 Node.js，无需安装任何 npm 包：

```powershell
cd D:\Codex_Project\Codex_cottoncal\web
node .\server.mjs
```

然后访问 <http://127.0.0.1:4173>。也可以使用其他端口：

```powershell
$env:PORT = '8080'
node .\server.mjs
```

正常访问会跟随系统深浅色；强调色由右上角“主题”控制。本地视觉检查时可临时使用 `?theme=light` 或 `?theme=dark` 固定预览明暗，该参数只影响当次显示。

运行测试：

```powershell
node --test
```

## 电脑端使用

电脑本地使用时运行 `server.mjs`，通过 `http://127.0.0.1:4173` 打开；不需要域名。部署到服务器后可通过域名访问，HTTPS 仍是推荐配置。

不要直接双击 `index.html`：浏览器会限制 `file://` 下的 JavaScript 模块与 Service Worker。iOS/iPadOS 和其他手机端保留现状，但不再维护或验收。

## 当前交付包

- 历史手机端包：`deliverables/current/cottoncal-mobile-v1.1.0.zip`，仅保留 v1.1.0 归档价值，不再更新或提供 iOS 支持。
- 服务器代理交接包：`deliverables/current/cottoncal-server-handoff-v1.1.0.zip`。包含部署说明、验收清单、Nginx 示例、配置描述文件模板和逐文件 SHA-256。
- 当前包校验值与版本说明：`deliverables/current/CHECKSUMS.sha256`、`deliverables/current/VERSION.md`。
- 历史归档：`deliverables/archive/`；旧 ZIP 使用时间戳文件名平铺保存，说明集中在根部 `VERSIONS.md`，不建立日期子文件夹。

后续更新运行：

```powershell
pwsh.exe -NoLogo -NoProfile -NonInteractive -File .\scripts\build-deliverables.ps1
```

该脚本是 v1.1.0 时期的历史交付脚本；后续电脑端版本发布时应先调整其产物名称与内容，不再生成手机端或 Web Clip 交付物。它不会连接或修改服务器。

## 验收边界

本项目后续验收仅覆盖电脑端浏览器。建议至少验证：

- Chrome、Edge 等目标电脑浏览器中的计算与状态保存；
- 不同桌面窗口宽度、键盘操作和缩放显示；
- `mailto:`、联系作者弹层及二维码显示；
- 本地服务器启动、在线部署和离线缓存更新。

本次实际执行记录见 [VERIFICATION.md](./VERIFICATION.md)。
