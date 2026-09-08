"""API 层接线：把桥接字段接入请求处理与响应回传。

这是 incon_bridge 插件的「安装器」——由插件在 register 时调用，
用 monkey-patch 方式挂到 uwa 的 FastAPI 路由上，
从而完全避免修改 app/ 下的任何源文件（保护 updater.py 的上游同步）。

接入两件事：
  1. 请求进来时，解析 history_mode / force_new_conversation 等字段，
     存进 contextvar 供 resolve_history 钩子读取
  2. 响应出去前，把 conversation_url 等挂到 x_uwa 字段
     （x_uwa 内容由 hooks.on_workflow_end 在收尾时写入 hooks._LAST_XUWA）

历史教训（勿回退）：
  - 插件加载时机早于 main.py 里 `app = FastAPI(...)`，此时
    sys.modules['__main__'].app 尚不存在；曾用 importlib 重新加载
    sidecar 根 main.py 取 app —— 得到的是第二个 FastAPI 实例
    （无 middleware_stack、不被 uvicorn serve），中间件注册后永不生效。
    正确做法：轮询 __main__.app，等真正的 app 诞生后立即挂载。
  - 曾对「找不到 app / 找不到响应构造函数」直接假成功，导致请求字段
    与 x_uwa 从未生效。失败必须如实上报。
"""
from __future__ import annotations

import logging
import sys
import threading
import time
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger("uwa.incon_bridge.api")

_INSTALLED = False
_INSTALL_LOCK = threading.Lock()
_PATCHED_INIT = False


def _load_protocol():
    """加载 bridge/protocol.py（与 protocol.ts 同一份契约）。"""
    import importlib.util
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


def _live_app():
    """真正的 FastAPI app（uvicorn 正在 serve 的那个）。

    sidecar 以 `python main.py` 启动：app 挂在 __main__ 模块上，
    且要到 main.py 执行完 `app = FastAPI(...)` 之后才存在。
    uvicorn CLI 方式启动时回退 import app.main（该路径的 app 模块与
    插件同进程可共享）。
    """
    try:
        main_mod = sys.modules.get("__main__")
        app = getattr(main_mod, "app", None)
        if app is not None and hasattr(app, "middleware_stack"):
            return app
    except Exception:
        pass
    try:
        import app.main as app_main  # type: ignore

        app = getattr(app_main, "app", None)
        if app is not None and hasattr(app, "middleware_stack"):
            return app
    except Exception:
        pass
    return None


def _make_middleware_class(proto: Any):
    """构造挂载用的中间件类（依赖 proto，故放工厂里）。"""
    import json as _json

    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import Response, StreamingResponse

    from . import hooks as bridge_hooks

    async def _finalize_body_extension(
        response: Any, ext: Optional[Dict[str, Any]]
    ) -> Response:
        """把 ext 作为 x_uwa 挂到响应体（JSON 直接改 body；SSE 追加末帧）。

        读值时机（历史教训）：_LAST_XUWA 由 on_workflow_end 在收尾阶段写入，
        而收尾晚于 workflow 的最后一个内容 chunk、但早于流结束。若在
        dispatch 同步段读（旧实现），SSE 读到的总是上一轮的残留值；
        因此 SSE 分支必须把读取推迟到流消费过程中、[DONE] 帧到手时——
        此刻当轮收尾已完成，帧又能插在 [DONE] 之前被客户端读到。
        """
        content_type = str(response.headers.get("content-type", "")).lower()
        if "text/event-stream" in content_type:
            original = getattr(response, "body_iterator", None)
            if original is None:
                return response

            async def _wrap():
                # OpenAI SSE 以 data: [DONE] 收尾；客户端遇到 [DONE] 即停止，
                # 因此 x_uwa 帧必须插在 [DONE] 之前，否则永远读不到。
                last_chunk: Optional[bytes] = None
                try:
                    async for chunk in original:
                        if last_chunk is not None:
                            yield last_chunk
                        last_chunk = chunk
                except Exception:
                    # 上游异常：先让调用方看到错误再补帧
                    if last_chunk is not None:
                        yield last_chunk
                        last_chunk = None
                    raise
                finally:
                    try:
                        if last_chunk is None:
                            payload_bytes = ("data: %s\n\n" % _json.dumps(
                                {"x_uwa": ext}, ensure_ascii=False
                            )).encode("utf-8") if ext else b""
                            if payload_bytes:
                                yield payload_bytes
                        elif b"[DONE]" in last_chunk:
                            # 此刻当轮收尾已完成：读最新值而非 dispatch 时旧值
                            fresh = bridge_hooks.get_last_xuwa()
                            if fresh:
                                payload_bytes = ("data: %s\n\n" % _json.dumps(
                                    {"x_uwa": fresh}, ensure_ascii=False
                                )).encode("utf-8")
                                yield payload_bytes
                            yield last_chunk
                        else:
                            yield last_chunk
                            if ext:
                                payload_bytes = ("data: %s\n\n" % _json.dumps(
                                    {"x_uwa": ext}, ensure_ascii=False
                                )).encode("utf-8")
                                yield payload_bytes
                    except Exception:
                        pass

            new_headers = dict(response.headers)
            new_headers.pop("content-length", None)
            return StreamingResponse(
                _wrap(),
                status_code=response.status_code,
                headers=new_headers,
                media_type=response.media_type,
            )

        if "application/json" in content_type or "json" in content_type:
            try:
                if hasattr(response, "body_iterator"):
                    raw = b"".join([c async for c in response.body_iterator])
                else:
                    raw = response.body
                body = _json.loads(raw or b"{}")
                if isinstance(body, dict):
                    # 非流式：body 已完整，收尾必已完成，取最新值
                    fresh = bridge_hooks.get_last_xuwa()
                    if not fresh:
                        return response
                    body["x_uwa"] = fresh
                    new_headers = dict(response.headers)
                    new_headers["content-length"] = str(
                        len(_json.dumps(body, ensure_ascii=False).encode("utf-8"))
                    )
                    return Response(
                        content=_json.dumps(body, ensure_ascii=False),
                        status_code=response.status_code,
                        headers=new_headers,
                        media_type="application/json",
                    )
            except Exception:
                pass
            return response

        return response

    class _BridgeMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: Callable):
            is_chat = (
                request.method == "POST"
                and "chat/completions" in request.url.path
            )
            ext: Optional[Any] = None
            if is_chat:
                try:
                    raw = await request.body()
                    payload = _json.loads(raw or b"{}")
                    if isinstance(payload, dict):
                        ext = proto.UwaRequestExtension.from_payload(payload)
                        bridge_hooks.set_request_extension(ext)
                except Exception:
                    pass  # 解析失败不阻断请求

            response = await call_next(request)

            if is_chat and ext is not None:
                mode = str(getattr(ext, "history_mode", "") or "").lower()
                if mode == "ide":
                    # ext 仅作“本次请求确属 ide 模式”的开关；具体帧值
                    # SSE 在流尾取当轮收尾，JSON 在下方取（此时已收尾）。
                    response = await _finalize_body_extension(
                        response, None if ext is None else ext
                    )
            return response

    return _BridgeMiddleware


def _attach(app: Any, proto: Any) -> bool:
    """把中间件挂到已就绪的 app 上；重复调用安全。"""
    global _INSTALLED
    with _INSTALL_LOCK:
        if _INSTALLED:
            return True
        try:
            mw_cls = _make_middleware_class(proto)
            before = len(app.user_middleware)
            app.add_middleware(mw_cls)
            after = len(app.user_middleware)
            logger.info(
                "[incon_bridge] 中间件已挂载到运行中的 FastAPI app "
                "(user_middleware %s->%s)",
                before,
                after,
            )
            _INSTALLED = True
            return True
        except Exception as exc:
            logger.warning("[incon_bridge] 中间件挂载失败: %s", exc)
            return False


def _patch_fastapi_init(proto: Any) -> bool:
    """monkey-patch FastAPI.__init__：app 实例一诞生就挂载中间件。

    为何必须这样：sidecar 的 main.py 里 `app = FastAPI(...)` 在插件
    加载之后才执行，而新版 starlette 禁止在 app 启动（uvicorn 接管）后
    再 add_middleware。因此只能在「实例化完成、尚未启动」的窗口挂载。
    """
    global _PATCHED_INIT
    if _PATCHED_INIT:
        return True
    try:
        import fastapi

        orig_init = fastapi.FastAPI.__init__

        def _init_with_bridge(self, *args: Any, **kwargs: Any):
            orig_init(self, *args, **kwargs)
            try:
                with _INSTALL_LOCK:
                    if _INSTALLED:
                        return
                # 实例刚构建完、尚未 serve，可以安全加中间件
                try:
                    _attach(self, proto)
                except Exception as exc:
                    logger.warning("[incon_bridge] 实例挂载中间件失败: %s", exc)
            except Exception:
                pass

        fastapi.FastAPI.__init__ = _init_with_bridge
        _PATCHED_INIT = True
        logger.info(
            "[incon_bridge] 已 hook FastAPI.__init__，将在 app 创建时挂载中间件"
        )
        return True
    except Exception as exc:
        logger.warning("[incon_bridge] patch FastAPI 失败: %s", exc)
        return False


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

    # 若 app 已就绪（插件晚于 main.py 加载的场景）直接挂载
    app = _live_app()
    if app is not None:
        return _attach(app, proto)

    # app 尚未构建：patch FastAPI 类，等真正的 app 一诞生就挂载
    if _patch_fastapi_init(proto):
        logger.info(
            "[incon_bridge] FastAPI app 尚未创建，已预约创建时挂载中间件"
        )
        # 挂载会在 app 创建后异步完成；此刻如实返回 False 以便调用方知晓
        return False
    return False
