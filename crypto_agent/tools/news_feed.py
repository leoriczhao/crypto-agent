import json
import xml.etree.ElementTree as ET
from urllib.request import urlopen, Request
from urllib.error import URLError
from .registry import register_tool

POSITIVE = {"surge", "rally", "bull", "gain", "rise", "soar", "jump", "high", "boom", "buy", "breakout", "adoption"}
NEGATIVE = {"crash", "dump", "bear", "drop", "fall", "plunge", "low", "sell", "fear", "hack", "ban", "fraud"}

CRYPTOPANIC_URL = "https://cryptopanic.com/api/free/v1/posts/?auth_token=free&currencies={currency}&kind=news"
COINDESK_RSS = "https://www.coindesk.com/arc/outboundfeeds/rss/"


def _fetch_cryptopanic(currency: str, limit: int) -> list[dict]:
    url = CRYPTOPANIC_URL.format(currency=currency)
    req = Request(url, headers={"User-Agent": "CryptoAgent/0.1"})
    with urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
    results = data.get("results", [])[:limit]
    return [{"title": r["title"], "url": r.get("url", ""), "published": r.get("published_at", "")} for r in results]


def _fetch_coindesk_rss(limit: int) -> list[dict]:
    req = Request(COINDESK_RSS, headers={"User-Agent": "CryptoAgent/0.1"})
    with urlopen(req, timeout=10) as resp:
        tree = ET.parse(resp)
    items = tree.findall(".//item")[:limit]
    return [{"title": item.findtext("title", ""), "url": item.findtext("link", ""), "published": item.findtext("pubDate", "")} for item in items]


def _score_sentiment(title: str) -> tuple[str, int]:
    words = set(title.lower().split())
    pos = len(words & POSITIVE)
    neg = len(words & NEGATIVE)
    if pos > neg:
        return "positive", pos - neg
    elif neg > pos:
        return "negative", neg - pos
    return "neutral", 0


@register_tool(
    name="news_feed",
    description=(
        "Crypto news and sentiment analysis.\n"
        "- headlines: fetch latest crypto news headlines\n"
        "- sentiment: keyword-based sentiment analysis on recent headlines for a symbol"
    ),
    schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["headlines", "sentiment"]},
            "symbol": {"type": "string", "description": "Currency symbol, e.g. BTC", "default": "BTC"},
            "limit": {"type": "integer", "description": "Number of headlines", "default": 5},
        },
        "required": ["action"],
    },
)
async def handle_news_feed(exchange, action: str, symbol: str = "BTC", limit: int = 5, **_) -> str:
    try:
        try:
            headlines = _fetch_cryptopanic(symbol.upper().split("/")[0], limit)
        except (URLError, OSError, json.JSONDecodeError, KeyError):
            try:
                headlines = _fetch_coindesk_rss(limit)
            except Exception:
                headlines = []

        if action == "headlines":
            if not headlines:
                return f"No headlines available for {symbol} at this time."
            lines = [f"📰 Latest {symbol} headlines:"]
            for i, h in enumerate(headlines, 1):
                lines.append(f"{i}. {h['title']}")
                if h.get("published"):
                    lines.append(f"   {h['published']}")
            return "\n".join(lines)

        elif action == "sentiment":
            if not headlines:
                return f"No headlines to analyze for {symbol}."
            scored = []
            total_pos, total_neg = 0, 0
            for h in headlines:
                label, strength = _score_sentiment(h["title"])
                if label == "positive":
                    total_pos += strength
                elif label == "negative":
                    total_neg += strength
                scored.append({"title": h["title"], "sentiment": label, "strength": strength})

            if total_pos > total_neg:
                overall = "BULLISH"
            elif total_neg > total_pos:
                overall = "BEARISH"
            else:
                overall = "NEUTRAL"

            lines = [f"Sentiment analysis for {symbol}: {overall} (pos={total_pos}, neg={total_neg})", ""]
            for s in scored:
                icon = {"positive": "🟢", "negative": "🔴", "neutral": "⚪"}[s["sentiment"]]
                lines.append(f"  {icon} [{s['sentiment']}] {s['title']}")
            return "\n".join(lines)

        return f"Unknown action: {action}"
    except Exception as e:
        return f"Error in news_feed: {e}"
