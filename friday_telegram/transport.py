"""
Friday-OS — Telegram Fallback Transport
Mirrors Hermes TelegramFallbackTransport:
- Seed IPs (149.154.166.110, 149.154.167.220) fast fallback
- TCP keepalive socket configuration
- Connection pooling limits
"""

import socket
import logging
from typing import List, Optional, Dict
import httpx

log = logging.getLogger("friday.telegram.transport")

# Telegram Data Center seed IPs (official dual-stack core IPs)
SEED_IPS = ["149.154.166.110", "149.154.167.220"]
TELEGRAM_API_HOST = "api.telegram.org"
TELEGRAM_API_BASE = f"https://{TELEGRAM_API_HOST}"


def _get_socket_options():
    """Build cross-platform TCP keepalive socket options."""
    options = [
        (socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1),
    ]
    # Linux/BSD specific TCP keepalive tuning (30s idle, 10s intvl, 3 probes)
    if hasattr(socket, "TCP_KEEPIDLE"):
        options.append((socket.IPPROTO_TCP, getattr(socket, "TCP_KEEPIDLE"), 30))
    elif hasattr(socket, "TCP_KEEPALIVE"):
        options.append((socket.IPPROTO_TCP, getattr(socket, "TCP_KEEPALIVE"), 30))
    if hasattr(socket, "TCP_KEEPINTVL"):
        options.append((socket.IPPROTO_TCP, getattr(socket, "TCP_KEEPINTVL"), 10))
    if hasattr(socket, "TCP_KEEPCNT"):
        options.append((socket.IPPROTO_TCP, getattr(socket, "TCP_KEEPCNT"), 3))
    return options


class FallbackTransport(httpx.AsyncBaseTransport):
    """
    High-resilience HTTP transport for Telegram Bot API.
    Tries DNS/hostname first with TCP keepalive; on network/DNS failure,
    transparently falls back to DC seed IPs with 'Host: api.telegram.org'.
    """

    def __init__(self, fallback_ips: Optional[List[str]] = None, **kwargs):
        self._ips = fallback_ips or SEED_IPS
        socket_opts = _get_socket_options()
        
        limits = httpx.Limits(
            max_connections=16,
            max_keepalive_connections=8,
            keepalive_expiry=60.0,
        )
        
        # Primary transport (standard hostname routing)
        self._primary = httpx.AsyncHTTPTransport(
            limits=limits,
            socket_options=socket_opts,
            **kwargs
        )
        # Dedicated IP transports
        self._ip_transports: Dict[str, httpx.AsyncHTTPTransport] = {}
        for ip in self._ips:
            self._ip_transports[ip] = httpx.AsyncHTTPTransport(
                limits=limits,
                socket_options=socket_opts,
                **kwargs
            )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        """Handle request with automatic IP fallback on connection errors."""
        primary_err: Optional[Exception] = None
        # 1. Try standard hostname transport first
        try:
            return await self._primary.handle_async_request(request)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.NetworkError) as err:
            primary_err = err
            log.warning(f"Primary connection to {request.url.host} failed ({err}), engaging seed-IP fallback...")

        # 2. Try each seed IP sequentially
        last_error = None
        for ip in self._ips:
            try:
                ip_request = self._rewrite_to_ip(request, ip)
                transport = self._ip_transports[ip]
                response = await transport.handle_async_request(ip_request)
                log.info(f"Fallback connection via seed IP {ip} succeeded (HTTP {response.status_code})")
                return response
            except Exception as ip_err:
                log.warning(f"Seed IP {ip} connection attempt failed: {ip_err}")
                last_error = ip_err

        # 3. If all seed IPs failed, retry primary one last time or raise error
        if last_error:
            raise last_error
        if primary_err:
            raise primary_err
        return await self._primary.handle_async_request(request)

    def _rewrite_to_ip(self, req: httpx.Request, ip: str) -> httpx.Request:
        """Clone request targeting direct IP while preserving Host header and TLS SNI."""
        url = req.url.copy_with(host=ip)
        headers = dict(req.headers)
        headers["host"] = TELEGRAM_API_HOST
        return httpx.Request(
            method=req.method,
            url=url,
            headers=headers,
            content=req.content,
            extensions=req.extensions,
        )

    async def aclose(self):
        """Close all pooled connections."""
        await self._primary.aclose()
        for t in self._ip_transports.values():
            await t.aclose()


async def make_bot_client(
    token: str,
    base_url: str = TELEGRAM_API_BASE,
    timeout: float = 35.0,
) -> httpx.AsyncClient:
    """Build httpx client with fallback transport + TCP keepalive."""
    transport = FallbackTransport()
    clean_token = token.strip().strip("\"'")
    return httpx.AsyncClient(
        transport=transport,
        base_url=f"{base_url}/bot{clean_token}",
        timeout=httpx.Timeout(timeout, connect=10.0),
    )
