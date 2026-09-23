"""SEBI egress relay — a CONNECT-only tunnel to exactly one host.

www.sebi.gov.in drops TLS handshakes from Azure Korea Central, where the API runs, and answers from Azure East Asia. This
relay runs in East Asia and lets the API's SEBI connector (and nothing else) open a TCP tunnel to www.sebi.gov.in:443.

It never sees plaintext: the API does the TLS handshake with SEBI *through* the tunnel and verifies SEBI's certificate
itself, so the relay cannot read or change what SEBI returns. Everything that is not an authenticated
`CONNECT www.sebi.gov.in:443` from an allowed source is refused and logged.

    PROXY_USER, PROXY_PASSWORD   required (Basic auth, compared in constant time)
    ALLOWED_TARGET               default www.sebi.gov.in:443
    ALLOWED_SOURCES              optional comma-separated IPs/CIDRs (the API environment's outbound addresses)
    PORT                         default 3128
"""

from __future__ import annotations

import asyncio
import base64
import hmac
import ipaddress
import logging
import os

log = logging.getLogger("sebi-proxy")
MAX_HEAD = 8192
TUNNEL_MAX_SECONDS = 300  # a SEBI fetch is seconds; a tunnel never outlives this


class Config:
    def __init__(self, env: dict[str, str]):
        self.user, self.password = env["PROXY_USER"], env["PROXY_PASSWORD"]
        if len(self.password) < 24:
            raise SystemExit("PROXY_PASSWORD must be at least 24 characters")
        self.target = env.get("ALLOWED_TARGET", "www.sebi.gov.in:443").lower()
        self.sources = [ipaddress.ip_network(s.strip(), strict=False) for s in env.get("ALLOWED_SOURCES", "").split(",") if s.strip()]
        self.port = int(env.get("PORT", "3128"))

    def source_ok(self, ip: str) -> bool:
        return not self.sources or any(ipaddress.ip_address(ip) in n for n in self.sources)

    def auth_ok(self, header: str | None) -> bool:
        if not header or not header.lower().startswith("basic "):
            return False
        expected = base64.b64encode(f"{self.user}:{self.password}".encode()).decode()
        return hmac.compare_digest(header[6:].strip().encode(), expected.encode())


def _reply(w: asyncio.StreamWriter, status: str, extra: str = "") -> None:
    w.write(f"HTTP/1.1 {status}\r\n{extra}Content-Length: 0\r\nConnection: close\r\n\r\n".encode())


async def _pipe(r: asyncio.StreamReader, w: asyncio.StreamWriter) -> int:
    n = 0
    try:
        while chunk := await r.read(65536):
            w.write(chunk)
            await w.drain()
            n += len(chunk)
    finally:
        w.close()
    return n


async def handle(cfg: Config, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    peer = (writer.get_extra_info("peername") or ("?", 0))[0]
    verdict = "?"
    try:
        if not cfg.source_ok(peer):
            verdict = "403 source"
            _reply(writer, "403 Forbidden")
            return
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)  # the stream limit caps it at MAX_HEAD
        lines = head.decode("latin-1").split("\r\n")
        parts = lines[0].split()
        headers = {k.strip().lower(): v.strip() for k, _, v in (ln.partition(":") for ln in lines[1:] if ":" in ln)}
        if len(parts) != 3 or parts[0] != "CONNECT":
            verdict = f"405 {parts[0] if parts else '-'}"
            _reply(writer, "405 Method Not Allowed", "Allow: CONNECT\r\n")
            return
        if not cfg.auth_ok(headers.get("proxy-authorization")):
            verdict = "407"
            _reply(writer, "407 Proxy Authentication Required", 'Proxy-Authenticate: Basic realm="sebi"\r\n')
            return
        if parts[1].lower() != cfg.target:
            verdict = f"403 target {parts[1][:80]}"
            _reply(writer, "403 Forbidden")
            return
        host, port = cfg.target.rsplit(":", 1)
        try:
            up_r, up_w = await asyncio.wait_for(asyncio.open_connection(host, int(port)), 10)
        except (OSError, asyncio.TimeoutError) as e:
            verdict = f"502 {type(e).__name__}"
            _reply(writer, "502 Bad Gateway")
            return
        writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await writer.drain()
        up, down = await asyncio.wait_for(asyncio.gather(_pipe(reader, up_w), _pipe(up_r, writer)), TUNNEL_MAX_SECONDS)
        verdict = f"200 tunnel up={up} down={down}"
    except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError) as e:
        verdict = verdict if verdict != "?" else f"closed {type(e).__name__}"
    finally:
        log.info("%s %s", peer, verdict)  # never the credentials
        writer.close()


async def serve(cfg: Config) -> None:
    server = await asyncio.start_server(lambda r, w: handle(cfg, r, w), "0.0.0.0", cfg.port, limit=MAX_HEAD)
    log.info("CONNECT-only relay → %s on :%d (%d allowed source networks)", cfg.target, cfg.port, len(cfg.sources))
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    asyncio.run(serve(Config(dict(os.environ))))
