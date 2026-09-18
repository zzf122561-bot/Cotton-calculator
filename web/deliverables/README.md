# 交付包与归档

- `current/`：保留 v1.1.0 的历史手机端包、服务器交接包、校验值和版本说明。
- `archive/`：旧包直接以带时间戳的 ZIP 文件归档，不创建日期子文件夹。
- `archive/VERSIONS.md`：旧包的简短版本说明，直接放在归档目录根部。

> 维护范围更新：自 2026-09-06 起只维护电脑端。现有手机包、Web Clip 模板和下述构建命令仅作历史留档，后续发布前必须先把构建脚本调整为电脑端产物。

历史构建命令：

```powershell
pwsh.exe -NoLogo -NoProfile -NonInteractive -File .\scripts\build-deliverables.ps1
```

脚本仍会按 v1.1.0 的旧规则生成两个包，因此不要直接用于后续电脑端版本。服务器和域名部署不属于这个脚本的职责。
