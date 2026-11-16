# 机采棉独立 API 源码与运行合同

本服务只管理本衍生版的用户、服务器密码校验材料、计算参数与分享模板。不读取主站/主版数据库，不上传本机账本。常驻服务不包含初始凭据，不读取 bootstrap，也不会 seed 或重置已有数据。

## 运行配置

- Python 3.12；FastAPI/Uvicorn/SQLite，单 worker。常驻入口为 python run_server.py，内部调用原 machine_api:production_app 工厂；固定监听 0.0.0.0:8080、workers=1、关闭访问日志。不加载 .env 文件，配置由管理员明确注入进程/容器环境。
- 运行依赖 requirements.lock：14 项直接/传递依赖，精确版本与官方 PyPI SHA256；requirements-test.lock 引用运行锁并增加 9 项测试依赖。使用 --require-hashes。tools/lock_hashes.py 只从官方 PyPI 对已固定版本机械更新哈希，不能无审查升级版本。
- Docker 内端口 8080，固定非 root UID/GID 10001，独立持久目录 /app/data，库 /app/data/machine.sqlite3。数据库目录必须由 10001 可写，SQLite WAL/SHM 同目录。宿主回环 8766 是待部署现场核对的候选，源码不绑定它。
- .env.example 只有公共配置。MACHINE_DATABASE 指库路径；MACHINE_ORIGIN 必须是实际 HTTPS scheme+authority，不带路径。请求 Host/写请求 Origin 必须匹配。反代保留 Host 和 /v2/api/ 前缀；代理来源白名单及转发头规则见下节，不改变原同源/CSRF/角色合同。
- 只有显式 HTTP loopback origin 配合 MACHINE_DEV_INSECURE=1 才允许测试非 Secure Cookie，生产不能使用该开关。
- 默认普通请求每来源每分钟 120 次、密码操作每来源每分钟 30 次；同认证范围五次失败冷却三十秒。门板会话八小时、提升十五分钟。计数/会话/提升存于独立 SQLite，服务重启不恢复已撤销权限。
- Dockerfile 采用同一 PYTHON_BASE 的两阶段构建，只放行运行锁、常驻/一次性初始化源码、管理员核对的 wheelhouse/*.whl 和管理员维护的 manager-tools/backup_sqlite.py；.dockerignore 默认排除其余上下文，凭据、.env、SQLite、测试、build 和缓存均不进入上下文。PYTHON_BASE 默认值来自管理员 base-image.lock.json 的 linux/amd64 digest 引用，不是浮动标签；源码不自行查询或选择 registry 镜像版本。依赖哈希锁及 registry 身份记录都不等于整个容器镜像已验收。

tools/verify_locks.py 可独立从官方 PyPI 下载当前环境兼容 wheel 到内存，验证锁 SHA256 与 wheel 元数据的活动依赖闭包（extras 为空），只在 build/wheel-check-cache.json 留公开的已验哈希/官方URL/文件名/环境标记与锁文件摘要，复用条目不重复下载。此检查不安装/执行 wheel，不代替 pip --require-hashes 安装或其他OS/架构验收。当前 Windows pip 官方索引实际 dry-run 未成功（from versions:none），虽官方 JSON/文件可取、独立下载哈希通过，仍应由管理员在受控Linux/Docker环境验证安装，不能据此宣称部署依赖已验收。

~~~powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes -r requirements-test.lock
.\.venv\Scripts\python.exe -m pytest tests --basetemp=build/pytest-check -p no:cacheprovider
~~~

常驻命令：python run_server.py。不能直接挂公网，应由管理员通过同源 HTTPS 反代接入；不能绕过此入口改用无约束的 Uvicorn CLI。

### 可信代理来源与限流

FORWARDED_ALLOW_IPS 必须显式设置且非空，只接受逗号分隔的具体 IPv4/IPv6 地址，去空白、规范化并去重。拒绝 *、任何 CIDR（含 /32、/128）、主机名、端口、IPv6 zone/interface 后缀、空项、非法值及 unspecified/multicast 地址。示例文件故意留空；缺失/错误时退出码 2，不导入业务工厂、不打开监听端口、不退回信任所有或默认 loopback。

这些地址必须是**实际连接容器的反向代理来源地址**，不是浏览器公网客户端地址。Docker 网桥、宿主或代理拓扑可能改变来源；部署方须现场核对，不能在源码中固定猜一个网桥 IP。多个确定的代理地址可逐个列出，但不能以扩大网段代替调查。可信代理须正确重建或追加已核验的 X-Forwarded-For，并正确设置 X-Forwarded-Proto，不能任意透传客户端提供的伪造来源。Uvicorn 仅对 TCP 直连来源在白名单中的请求解析这些头，按链右侧第一个不可信来源取客户端；其他来源的伪造头不生效。原请求/密码操作限流仍使用 request.client.host，数值 120/30、密码失败冷却、PBKDF 和数据库事务不变。服务器仍需防火墙/回环绑定等部署网络隔离，IP 白名单不是身份凭据。

### 管理员离线 wheelhouse 构建

普通 Docker 构建只使用受核对的离线 runtime wheelhouse。管理员新建隔离构建上下文，放置本目录公开源码、wheelhouse/ 和 manager-tools/backup_sqlite.py；后两者不放回功能工作树、不由功能会话复制或交付。wheelhouse 与未修改的 requirements.lock 逐项匹配，适用于 Linux/amd64/CPython3.12，仅包含 14 项运行依赖，不含测试依赖、bootstrap 或数据库。备份工具是管理员维护的独立标准库程序，只供管理员独立任务显式运行；常驻入口不会调用初始化或备份工具，也不挂载 bootstrap。

管理员构建形式（仅说明，本轮不执行）：docker build --platform=linux/amd64 --build-arg PYTHON_BASE=<已核对的Python3.12-slim-bookworm引用@sha256:digest> -t <管理员候选镜像名> <管理员隔离构建上下文>。默认 PYTHON_BASE 为 python:3.12-slim-bookworm@sha256:2ed6491b93cd49272ee6de2b5a38440c3448360322c089fc23e370722d74179d，来自管理员 base-image.lock.json；任何覆盖值仍须由管理员核对和记录，两个阶段共用它。该 registry 记录报告 Python 3.12.15，只证明镜像身份，没有执行证据；本轮功能测试的 Windows Python 为 3.12.10，不能跨环境宣称覆盖新镜像。

依赖阶段使用 python -m pip install --no-index --find-links=/wheelhouse --only-binary=:all: --require-hashes --no-cache-dir --target=/opt/python -r requirements.lock，随后 PYTHONPATH=/opt/python python -m pip check；最终阶段只复制 /opt/python 并设置 PYTHONPATH=/opt/python，不保留 wheelhouse。wheelhouse 或 manager-tools/backup_sqlite.py 缺失会令 COPY 失败，不退回联网安装。原功能源码目录没有这两个管理员输入，不能直接将它当完整构建上下文。基础镜像解析/获取仍取决于管理员已有镜像缓存或受控 registry，不能把 pip 离线安装等同整个 Docker 构建无需网络。Linux 原安装证据仅覆盖其原环境；实际两阶段构建、最终导入、非 root 数据卷和备份恢复需另行验证，不自动继承 Windows 或旧 Linux 安装结果。

本轮针对性检查使用 tests/test_deploy_prep.py：启动缺/错配置拒绝、合法 IPv4/IPv6/多地址、固定常驻选项、可信代理下不同客户端限流、不可信直连伪造转发头无法绕过请求/密码限流，以及 Docker/示例配置源码合同。它们使用实际锁定 Uvicorn 配置和原 API 合成数据，不能代替真实 TCP/容器/生产反代验证。本机没有 Docker CLI 时只登记未覆盖，不安装 Docker、不启系统服务。

## 一次性私有初始化

仅管理员操作：python initialize.py --database /app/data/machine.sqlite3 --bootstrap /run/secrets/bootstrap.private.json。bootstrap 仅在独立临时初始化任务只读挂载；常驻容器不挂载、不保留它。不要用 shell 参数传密码，不要把私有材料放入静态目录、镜像、测试、普通部署清单或源码。

JSON 顶层严格为 schemaVersion=1、migrationGeneration=machine-cloud-20261003、defaultUser 与 adminCredential。defaultUser 严格为 name=默认用户、doorCredential、settingsCredential。每份 Credential 严格包含 algorithm=PBKDF2-HMAC-SHA256、credentialVersion=1、iterations=600000、keyBits=256、saltBase64（独立随机16字节）、verifierBase64（32字节）；文件中不放明文密码。此源码不提供真实凭据样例。

命令拒绝任何已存在的目标库，不覆盖、重初始化或补种。先在同文件系统临时库事务写入默认 UUID 用户、机采默认参数/模板、二级凭据、代次，关闭连接后原子无覆盖发布。失败不发布半成品；持久文件系统需支持硬链接，此条件须由管理员在部署时验证。缺库/错 schema/错代次/损坏管理员元数据时 ready/API 返回 503，不创建业务数据或启用默认旧密码。

新代次的初始化仅针对独立新库，不是通用旧服务器迁移工具。本轮原服务器没有此数据库；不得指向其他系统数据库。已有新库部署更新只复用数据卷，不执行 initialize。备份需采用 SQLite backup API 或停服务后备份库及相关状态，不在有活动 WAL 时仅复制主库。

## HTTP 合同

所有路由以前缀 /v2/api 开头。JSON 响应不缓存；错误仅返回 detail，不包含请求密码、哈希、数据库路径或参数内容。在线文档/在线 OpenAPI 关闭；本源码文档即路由合同。

| 方法 / 路由 | 权限 | 请求与响应要点 |
| --- | --- | --- |
| GET /healthz | 公开探针 | 200 {status:alive}，不读业务数据 |
| GET /readyz | 公开只读探针 | 200 {status:ready}，否则503；检查库/schema/代次与管理员元数据，不 seed，不泄露内部信息 |
| GET /session | 公开会话入口 | {csrf,user}；缺/无效 Cookie 发行匿名会话；user 为 null 或 {id,name,enabled} |
| GET /users | 公开入口列表 | 仅启用且未删除的 [{id,name}]，不返回凭据 |
| POST /login | 匿名或门板 | {userId,password}；仅验证选中 UUID 门板，换 Cookie/CSRF，撤销旧会话 |
| POST /unlock | 有效 Cookie | {password}；服务端得出 settings 或 admin，返回 {role,elevation}，不接受客户端指定角色 |
| POST /logout | 有效 Cookie/CSRF | {}；删除会话与关联提升，清除 Path=/v2 Cookie |
| GET /me/config | 门板当前用户 | {version,machine,template}；不接受其他用户 ID |
| PUT /me/config | 一级当前用户 | 同上完整对象；version 必须匹配，成功 {version:旧值+1}，过期409，不静默覆盖 |
| POST /me/password/{door或settings} | 一级当前用户 | {currentPassword,newPassword,confirmation}；核验对应旧密码，成功撤销该用户所有会话 |
| GET /admin/users | 二级 | 当前未删除用户 [{id,name,enabled}] |
| POST /admin/users | 二级 | {name,doorPassword,doorConfirmation,settingsPassword,settingsConfirmation}；201 新UUID与用户视图 |
| PATCH /admin/users/{id} | 二级 | {name?,enabled?}；用户名 trim/casefold 唯一，启停撤销目标旧会话 |
| DELETE /admin/users/{id} | 二级 | {}；软删除/禁用/撤销，UUID永不复用，新建同名不继承配置或会话 |
| POST /admin/users/{id}/password/{door或settings} | 二级 | {newPassword,confirmation}；不传、不核验目标旧密码；撤销目标所有会话 |
| POST /admin/password | 二级 | {currentPassword,newPassword,confirmation}；核验二级旧密码、递增管理员 epoch、撤销全部二级提升 |

生产 Cookie 名 machine_session，HttpOnly/Secure/SameSite=Strict/Path=/v2；令牌只在数据库存 SHA256 摘要。所有写请求包括 DELETE 需 Content-Type:application/json、匹配 Origin、X-CSRF-Token（来自 /session 或 /login）。一级/二级请求还需 X-Machine-Elevation（仅页面内存，绑定 Cookie 会话、角色/用户/epoch）；不能把它保存到 localStorage/sessionStorage/URL。刷新丢失提升不会撤销门板 Cookie。

新密码 8至128 字符，确认完全一致。二级管理员凭据改动撤销二级提升；普通凭据改动/重置/启停/删除撤销该用户所有会话，即使该会话此前提升为二级也不能沿用旧 CSRF。用户名公开仅用于门板选择，配置归属由服务器会话决定。

2026-10-04 用户批准跨层碰撞保护：二级不得与任何未删除普通用户的门板/一级密码相同，停用仍比较，删除排除。创建、本人两种改密、管理员两种重置拒绝新密码等于当前二级；二级自身改密比较所有未删除用户两种凭据。普通用户之间、本人门板/一级可重复，严格区分大小写。权限/对应旧密码先检查，再在同一 BEGIN IMMEDIATE 写事务中验证本次内存新密码与已有加盐校验材料并写入；不保存明文或额外密码指纹。拒绝返回通用422，不泄露碰撞用户、不部分写凭据、不执行成功后的授权撤销。

machine 仅接受十个机采字段（字符串数字）与 basis=seed或lint，校验小数位、非负、衣分/损耗及结果范围。template 为 {schemaVersion:1,blocks:[...]}，动态日期/依据/两侧价格/全部机采参数十二键各出现一次；动态块只能改顺序/visible，不能替换或重复；静态文字最多200字，块最多100个。

主要错误：401 密码/会话无效；403 权限/CSRF/Origin无效；404目标不存在；409名称/配置版本冲突；415非JSON；422字段/确认/业务范围无效；429限流/冷却含 Retry-After；503未就绪。DB损坏/不可用不能以本机密码或旧静态前端绕过。

## 部署验收边界

管理员核对独立数据卷权限、实际Python基础镜像、依赖哈希、单worker、反代Host/Origin/前缀、Cookie属性、请求大小限制、健康/就绪与持久备份后，先后端后前端。Docker HEALTHCHECK 在容器内只调用 readyz；探针不要求公网Host，业务路由仍要求配置Host。

后端故障保留数据并显示维护，或回滚兼容新认证数据库的版本；不能回滚到原 localStorage 鉴权。功能会话的 Windows pytest 与 Edge 回环证据不代替 Linux/Docker/生产HTTPS/真实bootstrap/部署或用户验收。
