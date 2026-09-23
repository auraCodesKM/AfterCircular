"""The relay's contract: only an authenticated CONNECT to the one allowed target, from an allowed source, gets a tunnel.

    uv run --project backend pytest infra/sebi-proxy
"""

import asyncio
import base64

from proxy import Config, handle

PASSWORD = "x" * 32
AUTH = "Proxy-Authorization: Basic " + base64.b64encode(f"svc:{PASSWORD}".encode()).decode() + "\r\n"


async def _echo(r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
    w.write(await r.read(100))
    await w.drain()
    w.close()


async def _ask(port: int, request: str, payload: bytes = b"") -> bytes:
    r, w = await asyncio.open_connection("127.0.0.1", port)
    w.write(request.encode() + payload)
    await w.drain()
    out = await asyncio.wait_for(r.read(4096), 5)
    if payload and out.startswith(b"HTTP/1.1 200"):
        out += await asyncio.wait_for(r.read(4096), 5)
    w.close()
    return out


async def _scenario(sources: str = "") -> dict[str, bytes]:
    echo = await asyncio.start_server(_echo, "127.0.0.1", 0)
    target = f"127.0.0.1:{echo.sockets[0].getsockname()[1]}"
    cfg = Config({"PROXY_USER": "svc", "PROXY_PASSWORD": PASSWORD, "ALLOWED_TARGET": target, "ALLOWED_SOURCES": sources})
    relay = await asyncio.start_server(lambda r, w: handle(cfg, r, w), "127.0.0.1", 0)
    port = relay.sockets[0].getsockname()[1]
    out = {
        "get": await _ask(port, "GET http://www.sebi.gov.in/ HTTP/1.1\r\nHost: www.sebi.gov.in\r\n" + AUTH + "\r\n"),
        "noauth": await _ask(port, f"CONNECT {target} HTTP/1.1\r\n\r\n"),
        "badauth": await _ask(port, f"CONNECT {target} HTTP/1.1\r\nProxy-Authorization: Basic Zm9vOmJhcg==\r\n\r\n"),
        "other": await _ask(port, "CONNECT www.google.com:443 HTTP/1.1\r\n" + AUTH + "\r\n"),
        "ok": await _ask(port, f"CONNECT {target} HTTP/1.1\r\n" + AUTH + "\r\n", b"ping"),
    }
    relay.close()
    echo.close()
    return out


def test_only_authenticated_connect_to_the_one_target_tunnels():
    out = asyncio.run(_scenario())
    assert out["get"].startswith(b"HTTP/1.1 405")
    assert out["noauth"].startswith(b"HTTP/1.1 407") and out["badauth"].startswith(b"HTTP/1.1 407")
    assert out["other"].startswith(b"HTTP/1.1 403")
    assert out["ok"].startswith(b"HTTP/1.1 200 Connection Established") and out["ok"].endswith(b"ping")


def test_unlisted_source_is_refused_before_anything_else():
    out = asyncio.run(_scenario(sources="10.0.0.0/8"))
    assert all(v.startswith(b"HTTP/1.1 403") for v in out.values())
