from types import SimpleNamespace

import main


def test_transcode_cache_uses_full_source_name_and_atomic_output(tmp_path, monkeypatch):
    first = tmp_path / "voice.wav"
    second = tmp_path / "voice.ogg"
    first.write_bytes(b"wav")
    second.write_bytes(b"ogg")
    command_outputs = []

    monkeypatch.setattr(main.shutil, "which", lambda _name: "ffmpeg")

    def fake_run(command, **_kwargs):
        temp_output = main.Path(command[-1])
        command_outputs.append(temp_output)
        temp_output.write_bytes(b"converted")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(main.subprocess, "run", fake_run)

    first_output = main._transcode_media(first, "mp3")
    second_output = main._transcode_media(second, "mp3")

    assert first_output.name == "voice.wav.mp3"
    assert second_output.name == "voice.ogg.mp3"
    assert first_output != second_output
    assert all(path != first_output and path != second_output for path in command_outputs)
    assert first_output.read_bytes() == b"converted"
    assert second_output.read_bytes() == b"converted"
    assert not list((tmp_path / "_transcoded").glob(".*.mp3"))


def test_transcode_failure_removes_temporary_output(tmp_path, monkeypatch):
    source = tmp_path / "voice.wav"
    source.write_bytes(b"wav")

    monkeypatch.setattr(main.shutil, "which", lambda _name: "ffmpeg")

    def fake_run(command, **_kwargs):
        main.Path(command[-1]).write_bytes(b"partial")
        return SimpleNamespace(returncode=1, stderr="failed")

    monkeypatch.setattr(main.subprocess, "run", fake_run)

    try:
        main._transcode_media(source, "mp3")
    except main.HTTPException as exc:
        assert exc.status_code == 500
    else:
        raise AssertionError("transcode failure should raise HTTPException")

    assert not list((tmp_path / "_transcoded").glob(".*.mp3"))
    assert not (tmp_path / "_transcoded" / "voice.wav.mp3").exists()
