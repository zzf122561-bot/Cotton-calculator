# App开发会话边界

本会话负责 app/ 的 Android 功能代码、功能文档与技术测试。可运行 JVM 测试、Lint、Android 测试源码编译和用于内部检查的 Debug 构建；生成于 build/ 的临时 APK 不得发布或移到发布目录。正式 assembleRelease、签名验证、测试 APK 对外提供、版本号变更、交接单与发版由管理员负责。

完成可测试增量后，按根目录 AGENTS.md 与 _manager/HANDOFF_TEMPLATE.md 向管理员会话发消息，说明代码路径、版本建议、测试证据、尚缺的设备验证和打包前提。项目级变更只提出建议，不自行修改根目录配置、签名文件或 _manager/。
