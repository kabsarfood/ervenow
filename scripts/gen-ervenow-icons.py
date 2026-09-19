# -*- coding: utf-8 -*-
"""Generate ERVENOW outline icon set (green #00594F + orange #FF7A00 accents)."""
from pathlib import Path

out = Path(__file__).resolve().parents[1] / "public" / "assets" / "icons"
out.mkdir(parents=True, exist_ok=True)

G = "#00594F"
O = "#FF7A00"
SW = "1.75"


def svg(body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
        f'stroke="{G}" stroke-width="{SW}" stroke-linecap="round" stroke-linejoin="round">\n'
        f"{body}\n</svg>\n"
    )


icons = {
    "location": svg(
        f'  <path d="M12 21s7-6.2 7-11.2A7 7 0 0 0 5 9.8C5 14.8 12 21 12 21z"/>\n'
        f'  <circle cx="12" cy="9.8" r="2.4" fill="{O}" stroke="none"/>'
    ),
    "search": svg(
        f'  <circle cx="11" cy="11" r="6.5"/>\n'
        f'  <path d="m20 20-3.8-3.8"/>\n'
        f'  <circle cx="11" cy="11" r="1.2" fill="{O}" stroke="none"/>'
    ),
    "cart": svg(
        f'  <path d="M3.5 5h1.8l1.6 10.2a1.6 1.6 0 0 0 1.6 1.3h8.7a1.6 1.6 0 0 0 1.6-1.3L20.5 8H7"/>\n'
        f'  <circle cx="9.2" cy="19.2" r="1.35" fill="{O}" stroke="none"/>\n'
        f'  <circle cx="16.8" cy="19.2" r="1.35"/>'
    ),
    "orders": svg(
        f'  <path d="M8.5 4.5H7A2.5 2.5 0 0 0 4.5 7v11A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5V7A2.5 2.5 0 0 0 17 4.5h-1.5"/>\n'
        f'  <rect x="8.5" y="3" width="7" height="3.2" rx="1.2"/>\n'
        f'  <path d="M8.5 11h7M8.5 14.5h5" stroke="{O}"/>'
    ),
    "account": svg(
        f'  <circle cx="12" cy="8" r="3.6"/>\n'
        f'  <path d="M5 19.5a7 7 0 0 1 14 0"/>\n'
        f'  <circle cx="12" cy="8" r="1.15" fill="{O}" stroke="none"/>'
    ),
    "store": svg(
        f'  <path d="M4.5 9.5 6 5.5h12l1.5 4"/>\n'
        f'  <path d="M5 9.5h14v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-10z"/>\n'
        f'  <path d="M10 20.5v-6h4v6"/>\n'
        f'  <path d="M8 9.5v-1a1.5 1.5 0 0 1 3 0v1M13 9.5v-1a1.5 1.5 0 0 1 3 0v1" stroke="{O}"/>'
    ),
    "restaurant": svg(
        f'  <path d="M7.5 3.5v7.2c0 1 .7 1.8 1.6 2V20.5"/>\n'
        f'  <path d="M7.5 3.5c1.2 0 2.2 1.2 2.2 2.7V8"/>\n'
        f'  <path d="M5.3 3.5c-1.2 0-2.2 1.2-2.2 2.7V8"/>\n'
        f'  <path d="M5.3 3.5v7.2c0 1 .7 1.8 1.6 2"/>\n'
        f'  <path d="M15.5 3.5v6.2c0 1.4.9 2.5 2.2 2.8V20.5"/>\n'
        f'  <path d="M15.5 3.5h.2c1.8 0 3.3 1.5 3.3 3.4V9" stroke="{O}"/>'
    ),
    "supermarket": svg(
        f'  <path d="M5 8.5h14l-1.2 9.2a1.8 1.8 0 0 1-1.8 1.5H8a1.8 1.8 0 0 1-1.8-1.5L5 8.5z"/>\n'
        f'  <path d="M8 8.5 9.2 4.8h5.6L16 8.5"/>\n'
        f'  <path d="M9.5 12h5M9.5 15h3.5" stroke="{O}"/>'
    ),
    "pharmacy": svg(
        f'  <rect x="7" y="3.5" width="10" height="4" rx="1.2"/>\n'
        f'  <path d="M7.5 7.5h9v10.2a2.3 2.3 0 0 1-2.3 2.3H9.8a2.3 2.3 0 0 1-2.3-2.3V7.5z"/>\n'
        f'  <path d="M12 11v5M9.5 13.5h5" stroke="{O}"/>'
    ),
    "services": svg(
        f'  <path d="M14.8 5.2a1.2 1.2 0 0 0-1.7 0L5.2 13a1.2 1.2 0 0 0 0 1.7l4.1 4.1a1.2 1.2 0 0 0 1.7 0l7.9-7.9a1.2 1.2 0 0 0 0-1.7z"/>\n'
        f'  <path d="m16.2 3.8 4 4"/>\n'
        f'  <circle cx="8.2" cy="15.8" r="1.1" fill="{O}" stroke="none"/>'
    ),
    "delivery": svg(
        f'  <path d="M3.5 7.5h10.5v8H3.5z"/>\n'
        f'  <path d="M14 10.5h3.6l2.2 2.8v2.2H14v-5z"/>\n'
        f'  <circle cx="7.2" cy="18.2" r="1.55"/>\n'
        f'  <circle cx="17.2" cy="18.2" r="1.55" fill="{O}" stroke="none"/>'
    ),
    "notification": svg(
        f'  <path d="M6.5 16.5h11l-1.2-1.5a5.8 5.8 0 0 1-1-3.3V9.5a4.3 4.3 0 0 0-8.6 0v2.2c0 1.2-.4 2.4-1 3.3z"/>\n'
        f'  <path d="M10 16.5a2 2 0 0 0 4 0"/>\n'
        f'  <circle cx="16.6" cy="6.2" r="1.35" fill="{O}" stroke="none"/>'
    ),
    "gift": svg(
        f'  <rect x="4.5" y="10" width="15" height="10" rx="1.5"/>\n'
        f'  <path d="M4.5 13.5h15"/>\n'
        f'  <path d="M12 10v10"/>\n'
        f'  <path d="M12 10c-2.2 0-3.8-1.5-3.8-3.1S9.5 4 12 6.2C14.5 4 15.8 5.3 15.8 6.9S14.2 10 12 10z" stroke="{O}"/>'
    ),
    "more": svg(
        f'  <circle cx="5.5" cy="12" r="1.6"/>\n'
        f'  <circle cx="12" cy="12" r="1.6" fill="{O}" stroke="none"/>\n'
        f'  <circle cx="18.5" cy="12" r="1.6"/>'
    ),
    "order-status": svg(
        f'  <circle cx="12" cy="12" r="8.2"/>\n'
        f'  <path d="M12 7.5v5l3.2 1.8" stroke="{O}"/>\n'
        f'  <circle cx="12" cy="12" r="1" fill="{G}" stroke="none"/>'
    ),
    "register-store": svg(
        f'  <path d="M4.5 9.5 6 5.5h12l1.5 4"/>\n'
        f'  <path d="M5 9.5h14v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-10z"/>\n'
        f'  <path d="M12 13v5M9.5 15.5h5" stroke="{O}"/>'
    ),
    "home": svg(
        f'  <path d="M4 10.8 12 4.2l8 6.6V20a1 1 0 0 1-1 1h-5.2v-6.2H10.2V21H5a1 1 0 0 1-1-1z"/>\n'
        f'  <path d="M10.2 21v-6.2h3.6" stroke="{O}"/>'
    ),
    "explore": svg(
        f'  <circle cx="12" cy="12" r="8.2"/>\n'
        f'  <path d="m14.8 9.2-1.3 5.3-5.3 1.3 1.3-5.3z" stroke="{O}"/>'
    ),
    "gas": svg(
        f'  <path d="M9 3.5h6v2.2H9z"/>\n'
        f'  <path d="M8.2 5.7h7.6A2.2 2.2 0 0 1 18 7.9v9.6a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 17.5V7.9a2.2 2.2 0 0 1 2.2-2.2z"/>\n'
        f'  <path d="M10 11.5h4M12 9.5v4" stroke="{O}"/>'
    ),
    "flatbed": svg(
        f'  <path d="M3.5 9h9v5.5h-9z"/>\n'
        f'  <path d="M12.5 11.5H17l2.5 3V14.5h-7v-3z"/>\n'
        f'  <circle cx="7" cy="17.5" r="1.55"/>\n'
        f'  <circle cx="16.5" cy="17.5" r="1.55" fill="{O}" stroke="none"/>\n'
        f'  <path d="M4 9V7.5"/>'
    ),
    "beauty": svg(
        f'  <path d="M12 3.5 13.2 7.5H17l-3 2.3 1.1 4-3.1-2.2-3.1 2.2 1.1-4-3-2.3h3.8z"/>\n'
        f'  <path d="M7.5 16.5c1.2 0 2.2.9 2.2 2s-1 2-2.2 2-2.2-.9-2.2-2 .9-2 2.2-2z" stroke="{O}"/>\n'
        f'  <path d="M16.5 16.5c1.2 0 2.2.9 2.2 2s-1 2-2.2 2-2.2-.9-2.2-2 .9-2 2.2-2z"/>'
    ),
    "clothing": svg(
        f'  <path d="M9 3.8 12 6l3-2.2 2.8 1.5-1.7 2.5H16.5v11.2a1.3 1.3 0 0 1-1.3 1.3h-6.4a1.3 1.3 0 0 1-1.3-1.3V7.1H7.9L6.2 5.3z"/>\n'
        f'  <path d="M10 12.5h4" stroke="{O}"/>'
    ),
    "local-delivery": svg(
        f'  <path d="M4 8.5h9.5v7H4z"/>\n'
        f'  <path d="M13.5 11h3.2L19 13.5V15.5h-5.5v-4.5z"/>\n'
        f'  <circle cx="7" cy="17.8" r="1.4"/>\n'
        f'  <circle cx="16.2" cy="17.8" r="1.4"/>\n'
        f'  <path d="M8.5 5.5h4.5" stroke="{O}"/>'
    ),
}

for name, content in icons.items():
    (out / f"{name}.svg").write_text(content, encoding="utf-8")

print(f"wrote {len(icons)} icons -> {out}")
