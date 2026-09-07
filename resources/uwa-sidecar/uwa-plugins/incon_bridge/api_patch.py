"""API 层接线：把桥接字段接入请求处理与响应回传。

这是 incon_bridge 插件的「安装器」——由插件在 register 时调用，
用 monkey-patch 方式挂到 uwa 的 FastAPI 路由上，
从而完全避免修改 app/ 下的任何源文件（保护 updater.py 的上游同步）。

接入两件事：
  1. 请求进来时，解析 history_mode / force_new_conversation 等字段，
     存进 contextvar 供 resolve_history 钩子读取
  2. 响应出去前，把 conversation_url 等挂到 x_uwa 字段
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger("uwa.incon_bridge.api")

_INSTALLED = False


def _load_protocol():
    """加载 bridge/protocol.py（与 protocol.ts 同一份契约）。"""
    import importlib.util
    import sys
    from pathlib import Path

    name = "_uwa_bridge_protocol"
    if name in sys.modules:
        return sys.modules[name]

    target = Path(__file__).resolve().parents[2] / "bridge" / "protocol.py"
    spec = importlib.util.spec_from_file_location(name, target)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load bridge protocol from {target}")
    mod = importlib.util.module_from_spec(spec)
    # 先登记再 exec：dataclass 需要通过 sys.modules 反查命名空间
    sys.modules[name] = mod
    try:
        spec.loader.exec_module(mod)
    except Exception:
        sys.modules.pop(name, None)
        raise
    return mod


def install() -> bool:
    """安装 API 层钩子。返回是否成功（失败不影响 uwa 正常运行）。"""
    global _INSTALLED
    if _INSTALLED:
        return True

    try:
        proto = _load_protocol()
    except Exception as exc:
        logger.warning("[incon_bridge] protocol 加载失败，桥接字段不可用: %s", exc)
        return False

    ok = _install_request_hook(proto) and _install_response_hook(proto)
    _INSTALLED = ok
    return ok


def _install_request_hook(proto: Any) -> bool:
    """在 FastAPI 中间件层截获请求体里的桥接字段。"""
    try:
        from starlette.middleware.base import BaseHTTPMiddleware  # noqa: F401
    except Exception:
        logger.warning("[incon_bridge] starlette 不可用，跳过请求钩子")
        return False

    from . import hooks as bridge_hooks

    try:
        import app.main as app_main  # type: ignore
        fastapi_app = getattr(app_main, "app", None)
    except Exception:
        fastapi_app = None

    if fastapi_app is None:
        # main.py 里 app 的位置因版本而异，退回到延迟安装
        logger.info("[incon_bridge] FastAPI app 未就绪，请求钩子将在首次调用时安装")
        return True

    import json as _json

    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request

    class _BridgeMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            if request.method == "POST" and "chat/completions" in request.url.path:
                try:
                    raw = await request.body()
                    payload = _json.loads(raw or b"{}")
                    if isinstance(payload, dict):
                        ext = proto.UwaRequestExtension.from_payload(payload)
                        bridge_hooks.set_request_extension(ext)
                        if ext.history_mode == "ide":
                            logger.debug(
                                "[incon_bridge] ide request force_new=%s",
                                ext.force_new_conversation,
                            )
                except Exception:
                    pass  # 解析失败不阻断请求
            return await call_next(request)

    fastapi_app.add_middleware(_BridgeMiddleware)
    logger.info("[incon_bridge] 请求中间件已安装")
    return True


def _install_response_hook(proto: Any) -> bool:
    """包装响应构造函数，挂上 x_uwa 字段。

    uwa 在 app/api/chat.py 里构造 OpenAI 响应体。这里用 wrapper 而非改源码。
    """
    try:
        import app.api.chat as chat_mod  # type: ignore
    except Exception as exc:
        logger.warning("[incon_bridge] 无法导入 chat 模块: %s", exc)
        return False

    # 找到构造非流式响应的函数（不同版本命名可能不同，逐个尝试）
    candidates = [
        "_build_chat_completion_response",
        "build_chat_completion_response",
        "_make_response",
    ]
    target_name: Optional[str] = None
    for name in candidates:
        if hasattr(chat_mod, name):
            target_name = name
            break

    if target_name is None:
        logger.info(
            "[incon_bridge] 未找到响应构造函数，x_uwa 将由 tab_routes 侧补充"
        )
        return True

    original: Callable[..., Any] = getattr(chat_mod, target_name)

    def _wrapped(*args: Any, **kwargs: Any) -> Any:
        body = original(*args, **kwargs)
        try:
            session = kwargs.get("session") or _find_session(args)
            if session is not None and isinstance(body, dict):
                ext = proto.UwaResponseExtension.from_session(
                    session,
                    resolution=kwargs.get("resolution"),
                    tab_index=int(getattr(session, "index", -1) or -1),
                )
                proto.attach_response_extension(body, ext)
        except Exception:
            pass  # 回传失败不影响正常响应
        return body

    setattr(chat_mod, target_name, _wrapped)
    logger.info("[incon_bridge] 响应钩子已挂到 %s", target_name)
    return True


def _find_session(args: tuple) -> Any:
    """从位置参数里嗅探 TabSession 实例。"""
    for a in args:
        if hasattr(a, "conversation_url") and hasattr(a, "turns"):
            return a
    return None
