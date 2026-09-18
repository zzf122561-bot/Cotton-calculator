# 皮棉成本换算

一个完全离线的原生 Android 计算器，用于在籽棉收购价与皮棉最终入库成本之间双向换算。支持手摘棉、机采棉两套独立参数，并记住各自最后一次输入和计算方向。

项目级分工与发版规则见 [PROJECT.md](./PROJECT.md) 和 [AGENTS.md](./AGENTS.md)。本文件只说明 Android 功能；历史验收记录已移至 [_manager/releases/android/VERIFICATION.md](./_manager/releases/android/VERIFICATION.md)。测试包、正式 APK、版本号和 GitHub 推送由管理员负责。

## 使用方法

1. 在顶部选择“手摘棉”或“机采棉”。
2. 修改籽棉价，应用会自动计算皮棉价；修改皮棉价，则自动反算籽棉价。
3. 最后实际修改的价格会显示“计算依据”；仅点击或聚焦不会改变方向。
4. 衣分率、损耗率、棉籽价、加工费、人工费、入库费、财务费和补贴均可修改。
5. 点击“计算明细”可查看棉籽抵扣、原料成本和费用净额。
6. “恢复默认值”只重置当前棉种，且需要二次确认。
7. 点击右上角“联系作者”可拨打电话、创建邮件草稿或查看微信二维码；长按二维码可保存到系统相册。

籽棉手工输入最多保留6位小数；自动反算结果显示2位。皮棉价格按元/吨四舍五入到整数。所有计算使用 `BigDecimal`，中间过程不舍入。

## 离线与隐私

- 应用不申请网络权限，也没有登录、云同步、统计或广告功能。
- 参数使用 Android `SharedPreferences` 保存在应用私有目录。
- 系统云备份已关闭；卸载应用会删除已保存参数。

## 公式

```text
棉籽产出率 = 1 - 衣分率 - 损耗率
棉籽抵扣 = 棉籽产出率 × 棉籽价格

皮棉入库成本
= (籽棉价格 - 棉籽抵扣) ÷ 衣分率 × 1000
  + 加工费 + 人工费 + 入库费 + 财务费 - 补贴

反算籽棉价格
= [(皮棉入库成本 - 加工费 - 人工费 - 入库费 - 财务费 + 补贴)
   ÷ 1000 × 衣分率]
  + 棉籽抵扣
```

## 技术与构建

- Kotlin 2.2.21、Jetpack Compose、Material 3
- Android Gradle Plugin 8.13.2、Gradle 8.13、JDK 17
- `compileSdk/targetSdk 36`、`minSdk 29`（Android 10）
- 包名：`com.xuesui.cottoncal`

Windows首次准备构建环境：

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File .\scripts\bootstrap-android.ps1
```

脚本把JDK和Android SDK放在项目内的 `.tooling/`（已忽略），并验证Android命令行工具、JDK和Gradle发行包的SHA-256。准备完成后：

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebugAndroidTest assembleRelease
```

## 测试状态

- 14个JVM单元测试覆盖Excel样例、正反算、显示精度、费用/补贴和错误边界。
- 7个Android仪器测试覆盖最后编辑项、参数修改、明细、错误提示、恢复确认、联系作者弹层及双预设持久化。
- 仪器测试APK已成功编译；本次构建时ADB没有可用设备，所以真机运行验收仍待完成。
- Android Lint：0错误。保留3条有意警告：两个依赖的新版本要求SDK 37/AGP 9.1，另一个是自适应图标目录与minSdk的静态提示。
- 2026-09-05，用户完成v1.0.1实际使用验收并确认通过；该结论与上述构建环境中的设备测试状态分别记录。

## 发布签名备份

Release APK使用项目专用私钥签名。要保证以后能覆盖安装升级，必须同时安全备份：

- `private-signing/cottoncal-release.jks`
- `signing.properties`

二者已由 `.gitignore` 排除，也不会进入源码压缩包。丢失密钥或密码后无法再发布可覆盖升级的版本。
