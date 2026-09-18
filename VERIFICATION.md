# 验收记录

## v1.0.1（联系作者）

验证日期：2026-09-05（Asia/Shanghai）

### 已验证

- 右上角新增“联系作者”按钮，弹层显示作者单位、姓名、电话、邮箱及微信二维码。
- 电话使用系统拨号 Intent，邮箱使用系统邮件草稿 Intent，未声明网络权限。
- 二维码长按写入系统相册 `Pictures/皮棉成本换算`；`minSdk 29` 下不需要额外存储权限。
- `testDebugUnitTest`：成功，14个JVM测试全部通过。
- `lintDebug`：成功，0错误、4条已审查警告。
- `assembleDebugAndroidTest`：成功，7个仪器测试已编译成测试APK；新增测试覆盖联系作者弹层及二维码显示。
- `assembleRelease`：成功，版本 `versionCode 2`、`versionName 1.0.1`。
- `apksigner verify --verbose --print-certs`：成功，APK Signature Scheme v2，证书SHA-256仍为 `d4ce9e7734b90218efc7f6443a3386f71c2406f0183d1db38d5627d86a7fbd0f`。
- `zipalign -c -P 16 -v 4`：成功。
- 发布APK SHA-256：`9679f24cbc1e0103948f96c43c332b209e3fd180c3536805224eb920908fadbf`。
- APK权限清单仅含AndroidX生成的应用私有动态广播权限，不含 `android.permission.INTERNET` 或存储权限。

### 用户验收

- 2026-09-05，用户在实际使用后确认“很好用”，v1.0.1 验收通过。
- 构建验证时 `adb devices -l` 未列出设备，因此自动化记录仍只证明仪器测试成功编译；本条用户验收作为独立的真实使用结论记录，不与自动化证据混同。

## v1.0.0

验证日期：2026-08-13（Asia/Shanghai）

### 已验证

- `testDebugUnitTest`：成功，14个测试全部通过。
- `lintDebug`：成功，0错误、3条已审查警告。
- `assembleRelease`：成功。
- `assembleDebugAndroidTest`：成功，6个仪器测试已编译成测试APK。
- `apksigner verify --verbose --print-certs`：成功，APK Signature Scheme v2。
- `zipalign -c -P 16 -v 4`：成功。
- 应用包名：`com.xuesui.cottoncal`。
- 版本：`versionCode 1`、`versionName 1.0.0`。
- Android范围：`minSdk 29`、`targetSdk 36`。
- 发布证书SHA-256：`d4ce9e7734b90218efc7f6443a3386f71c2406f0183d1db38d5627d86a7fbd0f`。
- APK权限清单不含 `android.permission.INTERNET`；系统显示的应用私有动态广播权限由AndroidX自动生成，不提供联网能力。

### 待真机验收

构建时 `adb devices -l` 没有列出设备，因此以下项目不能标记为已验证：

- Android 10及以上设备安装和首次启动。
- 飞行模式下正反向换算。
- 应用重启后的参数恢复。
- 手摘棉/机采棉切换和恢复默认值的实际触控体验。
- 不同屏幕尺寸、字体大小和软键盘下的布局。

仪器测试代码已覆盖这些主要交互并通过编译，但编译成功不等同于真机运行成功。
