# Docker 数据库脚本

仅启动 **PostgreSQL** 与 **Redis**，不容器化前后端应用。

## Windows（PowerShell）

```powershell
# 项目根目录执行
.\script\docker\db-up.ps1      # 启动
.\script\docker\db-down.ps1    # 停止（保留数据）
.\script\docker\db-reset.ps1   # 清空数据卷后重来
```

## Git Bash / macOS / Linux

```bash
chmod +x script/docker/*.sh
./script/docker/db-up.sh
./script/docker/db-down.sh
```

## 默认连接

| 服务 | 地址 |
|------|------|
| PostgreSQL | `postgresql://postgres:postgres@127.0.0.1:5432/dpl304` |
| Redis | `redis://127.0.0.1:6379` |

与 `backend/.env.example` 一致，复制为 `backend/.env` 即可。

## 要求

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) 已安装并运行
- 本机 **5432 / 6379** 端口未被占用
