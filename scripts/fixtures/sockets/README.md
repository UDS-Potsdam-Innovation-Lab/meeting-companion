# Socket scan fixtures (macOS, `lsof`)

`lsof -a -p <pid> -n -P -F ftPnT -Tqs` listings for `node scripts/sockets.mjs --lsof <file> <pid>`, tested in
`src/config.test.ts`. Recorded on `macos-latest` (arm64) in CI run 41433082434 against a small Node process
(the pid is the `p` line of each file).

- `none.txt`: no network socket (only files, pipes and the kqueue): passes.
- `tcp-listen.txt`: a TCP server listening on `*:1234` (`TST=LISTEN`): fails.
- `udp-bound.txt`: a UDP socket bound to `*:<port>`: fails.
- `outbound.txt`: one outbound TCP connection to port 443 (`TST=ESTABLISHED`) and nothing listening: passes.
- `empty.txt`: no output at all, as when `lsof` found nothing for the process: fails (not a scan of the app).
