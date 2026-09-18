# 版本和本地包索引

本索引区分建仓前历史包、技术测试候选和用户验收后的正式发布。APK/ZIP 存在本地 _manager/releases/，由 .gitignore 排除；Git 与 GitHub 只保存说明、哈希和来源记录，不提供二进制备份。不要用同名包覆盖历史文件。

| 产品 | 版本 | 状态 | 本地包 SHA-256 | 源码关联 |
| --- | --- | --- | --- | --- |
| Android | 1.0.0 | 建仓前历史 | releases/android/v1.0.0/皮棉成本换算-v1.0.0.apk · 1a90b921783fb980e9238f73c9efb88aacd7f4e32b1ba8503f4a59e4b6494ff5 | 无可验证的 Git 提交绑定 |
| Android | 1.0.1 | 已有用户验收的建仓前包 | releases/android/v1.0.1/CottonCal-v1.0.1-release.apk · 9679f24cbc1e0103948f96c43c332b209e3fd180c3536805224eb920908fadbf | 基线 ed61d8e 是后建仓源码快照，不冒充原构建提交 |
| 网页 | 1.1.0 | 建仓前历史，今后仅电脑端 | releases/web/v1.1.0/cottoncal-server-handoff-v1.1.0.zip · 32fa334646475dad47c0e719bcfe6d8ae275c54ccfe601659823df14cf17a394 | 无可验证的 Git 提交绑定 |
| 网页手机包 | 1.1.0 | 仅历史归档，不再新增 | releases/web/v1.1.0/cottoncal-mobile-v1.1.0.zip · 62667bdaf1ea6045a9f4babd8405ba83da0a9c15ed0a629d7dc9cba260e8 | 不属于后续发布范围 |

Android v1.0.0 另留 source.zip，SHA-256 为 bc09649ee71bd9c1e240282003081469779c3a245cd57c9f03cc810b2c99b6a1。历史验证和验收原文保留在各产品目录；后续每个候选与正式版本另增独立清单，记录源码提交、包大小/哈希、签名信息、自动测试、设备/浏览器测试、用户验收及远端标签核对。
