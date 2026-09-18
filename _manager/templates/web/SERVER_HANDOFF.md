# 皮棉成本换算 __VERSION__ 服务器交接说明

本包由管理员基于源码提交 __SOURCE_COMMIT__ 制作，供服务器侧代理读取和部署。打包过程没有操作任何服务器或域名。

> 本包只面向电脑端网页，不包含手机网页包、iOS/iPadOS 安装说明或 Web Clip 配置。

## 交付性质

- 纯静态 PWA，无构建步骤、无 Node 运行时依赖、无数据库、无后端接口。
- ZIP 根目录中的 `index.html`、`styles.css`、`manifest.webmanifest`、`sw.js`、`js/`、`assets/`、`icons/` 必须保持相对目录结构。
- 业务计算使用浏览器端 BigInt 有理数；所有用户输入保存在浏览器 `localStorage`，不会自动传输。
- 具体功能变更、测试和用户验收以管理员的独立版本清单为准。

## 部署步骤

1. 为现有站点目录做可回滚备份。
2. 解压本包到单独发布目录，不要直接在旧目录上逐个覆盖。
3. 对照 `checksums.sha256` 校验包内文件。
4. 选择域名根目录或固定子目录发布。全部链接均为相对路径，子目录部署可用，但不要改变 `sw.js` 与 `index.html` 的相对位置。
5. 启用 HTTPS。普通局域网 HTTP 地址不能可靠安装 PWA。
6. 参考 `nginx-cottoncal.conf.example` 配置静态文件类型、Service Worker 更新策略与安全响应头。
7. 按 `DEPLOYMENT_CHECKLIST.md` 验收电脑端后再切流；失败时回滚到第 1 步备份。

## 缓存与更新

- `index.html` 和 `sw.js` 应使用 `Cache-Control: no-cache`，确保新版本能及时发现。
- Service Worker 缓存名以包内 `sw.js` 为准；只清理 `cottoncal-pwa-` 前缀下的旧缓存。
- 当前文件名未做内容哈希，建议其他静态资源使用短期缓存或按示例设置 `no-cache`；离线能力由 Service Worker 负责。
- 每次发布必须完整替换同一版本的静态文件，不能混用两个版本。

## 线索与隐私边界

- 当前“复制测算摘要”和 `mailto:` 只由用户主动触发，不埋点、不自动上报。
- 如以后增加询价表单、统计或 CRM，请单独做隐私告知、同意机制、反垃圾和数据保留方案；不要在本次静态包内偷偷加入。
