"""The active in-process ASR backend stays warm between requests.

``get_active_asr_backend()`` used to construct a fresh in-process backend on
every call, and a fresh backend holds no weights, so every
``POST /v1/audio/transcriptions`` (and every dictation, dub, batch and agent
call) reloaded Whisper: ~6 s for a 2 s clip with large-v3-turbo on CUDA
instead of ~0.5 s warm. The fix keeps one warm instance keyed by backend id +
resolved configuration, released on a model/engine switch, on unload and by
the memory manager — never while a transcribe is running on it.

Fail-before/pass-after: on the old code each ``load_active_asr_backend()``
returned a new instance and loaded again, so the load counts below are 2+.
"""
from __future__ import annotations

import threading

import pytest

pytestmark = pytest.mark.usefixtures("asr_model_installed")

from services import asr_backend as ab


@pytest.fixture
def loads(monkeypatch):
    """Count real weight loads and unloads on the whisper-family backends."""
    events: list[tuple[str, str]] = []

    def ensure_loaded(self):
        if self._model is None:
            events.append(("load", self._model_name))
            self._model = object()

    def unload(self):
        if self._model is not None:
            events.append(("unload", self._model_name))
        self._model = None

    def transcribe(self, audio_path, *, word_timestamps=True, language=None):
        return {"segments": [], "language": language or "en"}

    monkeypatch.setenv("OMNIVOICE_ASR_BACKEND", "faster-whisper")
    monkeypatch.setenv("ASR_MODEL_FASTER", "deepdml/faster-whisper-large-v3-turbo-ct2")
    for cls in (ab.FasterWhisperBackend, ab.WhisperXBackend):
        monkeypatch.setattr(cls, "ensure_loaded", ensure_loaded)
        monkeypatch.setattr(cls, "unload", unload)
        monkeypatch.setattr(cls, "transcribe", transcribe)
    # WhisperX keeps its model on `_asr`; give the fakes one handle to count.
    monkeypatch.setattr(ab.WhisperXBackend, "_model", None, raising=False)
    monkeypatch.setattr(ab.WhisperXBackend, "_pick_device", staticmethod(lambda: ("cpu", "int8")))
    yield events
    ab.reset_active_asr_backend()


def test_consecutive_requests_reuse_one_loaded_backend(loads):
    first = ab.load_active_asr_backend()
    second = ab.load_active_asr_backend()

    assert second is first
    assert loads == [("load", "deepdml/faster-whisper-large-v3-turbo-ct2")]


def test_a_model_switch_releases_the_old_model_and_loads_the_new(loads, monkeypatch):
    first = ab.load_active_asr_backend()
    monkeypatch.setenv("ASR_MODEL_FASTER", "Systran/faster-whisper-small")
    second = ab.load_active_asr_backend()

    assert second is not first
    assert loads == [
        ("load", "deepdml/faster-whisper-large-v3-turbo-ct2"),
        ("unload", "deepdml/faster-whisper-large-v3-turbo-ct2"),
        ("load", "Systran/faster-whisper-small"),
    ]


def test_an_engine_switch_releases_the_outgoing_engine(loads, monkeypatch):
    ab.load_active_asr_backend()
    monkeypatch.setenv("OMNIVOICE_ASR_BACKEND", "whisperx")
    backend = ab.load_active_asr_backend()

    assert isinstance(backend, ab.WhisperXBackend)
    assert loads[:2] == [
        ("load", "deepdml/faster-whisper-large-v3-turbo-ct2"),
        ("unload", "deepdml/faster-whisper-large-v3-turbo-ct2"),
    ]


def test_selecting_a_model_frees_the_warm_one_immediately(loads, monkeypatch):
    ab.load_active_asr_backend()
    ab.reset_active_asr_backend()

    assert loads[-1] == ("unload", "deepdml/faster-whisper-large-v3-turbo-ct2")
    assert ab.loaded_active_asr_backend() is None


def test_a_caller_unload_reloads_on_the_next_request(loads):
    """The dub and batch paths unload after transcribing to hand VRAM back."""
    ab.load_active_asr_backend().unload()
    ab.load_active_asr_backend()

    assert [kind for kind, _ in loads] == ["load", "unload", "load"]


def test_unload_waits_for_a_running_transcribe(loads, monkeypatch):
    backend = ab.load_active_asr_backend()
    started, finish = threading.Event(), threading.Event()

    def slow(self, audio_path, *, word_timestamps=True, language=None):
        started.set()
        finish.wait(5)
        assert self._model is not None, "weights were pulled mid-transcribe"
        return {"segments": []}

    monkeypatch.setattr(ab.FasterWhisperBackend, "transcribe", slow)
    worker = threading.Thread(target=backend.transcribe, args=("clip.wav",))
    worker.start()
    started.wait(5)

    backend.unload()  # e.g. a concurrent dub handing VRAM back to TTS
    assert not ab.release_idle_active_asr_backend(0.0)
    assert ("unload", backend._model_name) not in loads

    finish.set()
    worker.join(5)
    assert loads[-1] == ("unload", backend._model_name)


def test_memory_manager_releases_an_idle_model(loads):
    backend = ab.load_active_asr_backend()
    assert ab.loaded_active_asr_backend() is backend

    assert not ab.release_idle_active_asr_backend(3600.0)
    assert ab.release_idle_active_asr_backend(0.0)
    assert ab.loaded_active_asr_backend() is None
    assert loads[-1] == ("unload", backend._model_name)


def test_per_request_options_still_match_the_engine_signature(loads):
    backend = ab.load_active_asr_backend()

    assert ab.transcribe_request_kwargs(backend, {"language": "hi", "task": "translate"}) == {
        "language": "hi"
    }
    assert backend.transcribe("clip.wav", language="hi")["language"] == "hi"


def test_licence_is_still_checked_on_every_cached_use(loads, monkeypatch):
    from services.model_acceptance import ModelLicenceNotAccepted

    ab.load_active_asr_backend()

    def refuse(backend):
        raise ModelLicenceNotAccepted([{"repo_id": "deepdml/faster-whisper-large-v3-turbo-ct2"}])

    monkeypatch.setattr(ab, "ensure_backend_licence", refuse)
    with pytest.raises(ModelLicenceNotAccepted):
        ab.load_active_asr_backend()


def test_a_preloaded_tts_asr_pipe_is_never_cached(monkeypatch):
    monkeypatch.setenv("OMNIVOICE_ASR_BACKEND", "pytorch-whisper")
    pipe = object()

    first = ab.get_active_asr_backend(asr_pipe=pipe)
    second = ab.get_active_asr_backend(asr_pipe=pipe)

    assert first is not second
    assert first._pipe is pipe
    assert ab._active_asr is None


@pytest.mark.asyncio
async def test_loaded_models_lists_and_unloads_the_warm_asr(loads, monkeypatch):
    from services import model_lifecycle

    monkeypatch.setattr(model_lifecycle, "_backend_device", lambda backend: "cpu")
    ab.load_active_asr_backend()
    listed = {m["id"]: m for m in model_lifecycle.list_loaded()["models"]}
    assert listed["active-asr"]["unloadable"] is True
    assert listed["active-asr"]["checkpoint"] == "deepdml/faster-whisper-large-v3-turbo-ct2"

    assert (await model_lifecycle.unload("active-asr"))["success"] is True
    assert (await model_lifecycle.unload("active-asr"))["reason"] == "not loaded"
