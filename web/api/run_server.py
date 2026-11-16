"""Resident entrypoint: explicit proxy IPs, one worker, no initialization."""

import ipaddress
import os
import sys

import uvicorn


class StartupConfigurationError(ValueError):
    pass


def parse_forwarded_allow_ips(value: str | None) -> tuple[str, ...]:
    """Accept only individual, unscoped unicast IP literals; never trust networks."""
    message = "FORWARDED_ALLOW_IPS must contain explicit IPv4/IPv6 proxy addresses, separated by commas"
    if value is None or not value.strip():
        raise StartupConfigurationError(message)
    addresses = []
    for item in value.split(","):
        item = item.strip()
        if not item or "%" in item:
            raise StartupConfigurationError(message)
        try:
            address = ipaddress.ip_address(item)
        except ValueError:
            raise StartupConfigurationError(message) from None
        if address.is_unspecified or address.is_multicast:
            raise StartupConfigurationError(message)
        normalized = str(address)
        if normalized not in addresses:
            addresses.append(normalized)
    return tuple(addresses)


def main() -> int:
    try:
        if sys.version_info[:2] != (3, 12):
            raise StartupConfigurationError("Python 3.12 is required")
        proxies = parse_forwarded_allow_ips(os.environ.get("FORWARDED_ALLOW_IPS"))
    except StartupConfigurationError as exc:
        # Do not echo environment values or import the application on invalid configuration.
        print(f"Startup refused: {exc}", file=sys.stderr)
        return 2
    uvicorn.run(
        "machine_api:production_app",
        factory=True,
        host="0.0.0.0",
        port=8080,
        workers=1,
        access_log=False,
        proxy_headers=True,
        forwarded_allow_ips=",".join(proxies),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
