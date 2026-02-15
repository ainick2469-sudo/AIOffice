"""Web research helper with provider fallback order."""

from __future__ import annotations

import os
from urllib.parse import urlparse

import httpx

SEARXNG_URL = os.environ.get("SEARXNG_URL", "").strip()
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "").strip()
TAVILY_URL = "https://api.tavily.com/search"


def _provider_state() -> dict:
    return {
        "searxng": bool(SEARXNG_URL),
        "tavily": bool(TAVILY_API_KEY),
    }


async def search_web(query: str, limit: int = 5) -> dict:
    if not query.strip():
        return {"ok": False, "error": "Query is required.", "provider": None, "results": []}

    providers = _provider_state()
    if providers["searxng"]:
        result = await _search_searxng(query, limit=limit)
        if result.get("ok"):
            return result
    if providers["tavily"]:
        result = await _search_tavily(query, limit=limit)
        if result.get("ok"):
            return result

    return {
        "ok": False,
        "provider": None,
        "results": [],
        "error": "No web search provider configured (set SEARXNG_URL or TAVILY_API_KEY).",
    }


async def fetch_url(url: str) -> dict:
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "Only http/https URLs are allowed.", "url": url}
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url)
        text = resp.text[:12000]
        return {
            "ok": resp.status_code < 400,
            "url": url,
            "status_code": resp.status_code,
            "content_type": resp.headers.get("content-type", ""),
            "content": text,
        }
    except Exception as exc:
        return {"ok": False, "url": url, "error": str(exc)}


async def _search_searxng(query: str, limit: int) -> dict:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{SEARXNG_URL.rstrip('/')}/search",
                params={"q": query, "format": "json", "language": "en"},
            )
        if resp.status_code >= 400:
            return {"ok": False, "provider": "searxng", "results": [], "error": resp.text[:400]}
        payload = resp.json()
        results = []
        for item in (payload.get("results") or [])[:limit]:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": item.get("content", "")[:400],
                "source": _hostname(item.get("url", "")),
            })
        return {"ok": True, "provider": "searxng", "results": results}
    except Exception as exc:
        return {"ok": False, "provider": "searxng", "results": [], "error": str(exc)}


async def _search_tavily(query: str, limit: int) -> dict:
    headers = {"content-type": "application/json"}
    body = {
        "api_key": TAVILY_API_KEY,
        "query": query,
        "search_depth": "advanced",
        "max_results": limit,
        "include_answer": False,
    }
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            resp = await client.post(TAVILY_URL, headers=headers, json=body)
        if resp.status_code >= 400:
            return {"ok": False, "provider": "tavily", "results": [], "error": resp.text[:400]}
        payload = resp.json()
        results = []
        for item in (payload.get("results") or [])[:limit]:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": (item.get("content") or "")[:400],
                "source": _hostname(item.get("url", "")),
            })
        return {"ok": True, "provider": "tavily", "results": results}
    except Exception as exc:
        return {"ok": False, "provider": "tavily", "results": [], "error": str(exc)}


def _hostname(url: str) -> str:
    try:
        return urlparse(url).netloc
    except Exception:
        return ""
