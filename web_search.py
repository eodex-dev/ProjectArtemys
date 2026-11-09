"""Pesquisa na web com provedores intercambiáveis: DuckDuckGo (sem chave), Tavily e Brave Search.

Escolha com LUNA_SEARCH_PROVIDER=ddgs|tavily|brave. Se o provedor escolhido falhar ou não achar nada, a Luna usa o
DuckDuckGo como reserva (desligue com LUNA_SEARCH_FALLBACK=false). Os resultados são sempre texto de terceiros e nunca
são tratados como instruções.
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

_TAGS = re.compile(r"<[^>]+>")
_ROTULOS = {"ddgs": "DuckDuckGo", "tavily": "Tavily", "brave": "Brave Search"}
_CHAVES = {"tavily": "TAVILY_API_KEY", "brave": "BRAVE_API_KEY"}
_URLS = {"tavily": "https://api.tavily.com/search", "brave": "https://api.search.brave.com/res/v1/web/search"}


def _limpo(texto, limite=600) -> str:
    return re.sub(r"\s+", " ", _TAGS.sub("", str(texto or ""))).strip()[:limite]


def _http_json(url: str, *, dados=None, cabecalhos=None, timeout: float = 10) -> dict:
    corpo = json.dumps(dados).encode("utf-8") if dados is not None else None
    cab = {"Accept": "application/json", **(cabecalhos or {})}
    if corpo is not None:
        cab["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=corpo, headers=cab, method="POST" if corpo is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as resposta:
        return json.loads(resposta.read().decode("utf-8") or "{}")


def _item(titulo, corpo, link, data="", fonte="") -> dict:
    prefixo = ", ".join(p for p in (str(data or "")[:10], str(fonte or "")) if p)
    texto = _limpo(corpo)
    return {"title": _limpo(titulo, 200), "body": f"({prefixo}) {texto}" if prefixo and texto else texto, "href": str(link or "")}


def buscar_ddgs(consulta: str, noticias: bool, max_results: int) -> list[dict]:
    from ddgs import DDGS  # importado só quando usado

    backend = os.getenv("LUNA_DDGS_BACKEND", "auto").strip() or "auto"
    ddg = DDGS(timeout=8)
    resultados: list[dict] = []
    if noticias:
        try:
            for r in ddg.news(consulta, region="br-pt", timelimit="w", max_results=max_results):
                resultados.append(_item(r.get("title"), r.get("body"), r.get("url"), r.get("date"), r.get("source")))
        except Exception as exc:
            print(f"[Pesquisa DDG news] {exc}")
    if not resultados:
        for r in ddg.text(consulta, region="br-pt", max_results=max_results, backend=backend):
            resultados.append(_item(r.get("title"), r.get("body"), r.get("href") or r.get("url"), "", ""))
    return resultados


def buscar_tavily(consulta: str, noticias: bool, max_results: int) -> list[dict]:
    chave = os.getenv("TAVILY_API_KEY", "").strip()
    if not chave:
        raise RuntimeError("TAVILY_API_KEY não está configurada.")
    pedido = {"query": consulta, "max_results": max_results, "search_depth": "basic", "include_answer": False,
              "topic": "news" if noticias else "general"}
    if noticias:
        pedido["days"] = 7
    dados = _http_json(_URLS["tavily"], dados=pedido, cabecalhos={"Authorization": f"Bearer {chave}"})
    return [_item(r.get("title"), r.get("content"), r.get("url"), r.get("published_date")) for r in dados.get("results", [])]


def buscar_brave(consulta: str, noticias: bool, max_results: int) -> list[dict]:
    chave = os.getenv("BRAVE_API_KEY", "").strip()
    if not chave:
        raise RuntimeError("BRAVE_API_KEY não está configurada.")
    params = {"q": consulta[:380], "count": max(1, min(max_results, 20)), "country": "BR", "search_lang": "pt",
              "ui_lang": "pt-BR", "safesearch": "moderate"}
    if noticias:
        params["freshness"] = "pw"
    dados = _http_json(_URLS["brave"] + "?" + urllib.parse.urlencode(params), cabecalhos={"X-Subscription-Token": chave})
    achados = [_item(r.get("title"), r.get("description"), r.get("url"), r.get("age") if noticias else "")
               for r in (dados.get("web") or {}).get("results", [])]
    if noticias:
        recentes = [_item(r.get("title"), r.get("description"), r.get("url"), r.get("age"))
                    for r in (dados.get("news") or {}).get("results", [])]
        achados = recentes + achados
    return achados[:max_results]


_PROVEDORES = {"ddgs": buscar_ddgs, "tavily": buscar_tavily, "brave": buscar_brave}


def provedor_principal() -> str:
    nome = os.getenv("LUNA_SEARCH_PROVIDER", "ddgs").strip().casefold() or "ddgs"
    if nome not in _PROVEDORES:
        print(f"[Pesquisa] Provedor '{nome}' desconhecido; usando DuckDuckGo.")
        return "ddgs"
    return nome


def _erro_seguro(exc: Exception) -> str:
    texto = f"{type(exc).__name__}: {exc}"
    for variavel in _CHAVES.values():
        segredo = os.getenv(variavel, "").strip()
        if segredo:
            texto = texto.replace(segredo, "[chave ocultada]")
    return texto[:200]


def pesquisar(consulta: str, noticias: bool = False, max_results: int = 6) -> tuple[list[dict], str]:
    """Devolve (resultados, nome do provedor usado). Nunca levanta exceção: sem resultado, volta lista vazia."""
    consulta = consulta[:300]
    principal = provedor_principal()
    ordem = [principal]
    if principal != "ddgs" and os.getenv("LUNA_SEARCH_FALLBACK", "true").strip().casefold() != "false":
        ordem.append("ddgs")
    for nome in ordem:
        try:
            resultados = [r for r in _PROVEDORES[nome](consulta, noticias, max_results) if r["title"] or r["body"]]
        except Exception as exc:
            print(f"[Pesquisa {_ROTULOS[nome]}] falhou: {_erro_seguro(exc)}")
            continue
        print(f"[Pesquisa {_ROTULOS[nome]}] Consulta '{consulta}': {len(resultados)} resultado(s).")
        if resultados:
            return resultados, _ROTULOS[nome] + (" (reserva)" if nome != principal else "")
    return [], _ROTULOS[principal]
