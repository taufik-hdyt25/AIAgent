# TH Agent Restart Gateway

Small localhost-only service that can restart **only** `telegram-coding-agent.service` after an authenticated request. It is a building block for an administrator to install on the production host; creating this project does not install or activate it.

## Security and installation requirements

- Run as a dedicated unprivileged account.
- Keep `RESTART_TOKEN` in a root-readable environment file; never commit it.
- Bind is fixed to `127.0.0.1`; expose remotely only through a separately authenticated, TLS-protected control plane if truly required.
- Grant sudo narrowly, e.g. `systemctl restart telegram-coding-agent.service` only. The service itself invokes systemctl directly, so a production deployment must either run with a narrowly scoped systemd policy or adapt the command to a fixed sudoers rule. Never grant general root or arbitrary command execution.
- Verify the exact unit name and health after installing on the host. The unit name is deliberately allowlisted.
- Requests are rate-limited and return before the delayed restart, allowing callers to receive acknowledgement.

## Run locally

```sh
RESTART_TOKEN='long-random-secret' npm start
```

Health: `GET http://127.0.0.1:3817/health`
Restart: `POST /v1/restart` with `Authorization: Bearer <token>`.

This project cannot restart production until it is installed and granted the narrowly scoped host permission by an administrator.
