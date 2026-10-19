"""视频服务器中转回退（upload-relay + 本地磁盘流播）回归测试

背景：视频主链路是浏览器直传 OSS；本地开发/内网 OSS 凭证不可用时直传必败。
中转端点 OSS 优先、失败落盘 uploads/videos/；stream/play-url 本地优先回源。
"""

import os
import uuid

import pytest

from app.routers import videos
from app.services import video_files


class _FakeBucket:
    """记录调用；fail=True 模拟凭证失效/网络不通"""

    def __init__(self, fail=False, exists=False):
        self.fail = fail
        self._exists = exists
        self.uploaded = []

    def put_object_from_file(self, key, path):
        if self.fail:
            raise RuntimeError("403 AccessDenied")
        self.uploaded.append(key)

    def object_exists(self, key):
        if self.fail:
            raise RuntimeError("403 AccessDenied")
        return self._exists

    def sign_url(self, method, key, expire):
        return f"https://oss.example/{key}?sig=x"

    def delete_object(self, key):
        if self.fail:
            raise RuntimeError("403 AccessDenied")


@pytest.fixture
def local_video_dir(tmp_path, monkeypatch):
    """隔离磁盘目录 + 伪造凭证，确保测试不碰真实 OSS"""
    monkeypatch.setattr(video_files, "UPLOAD_DIR", str(tmp_path))
    os.makedirs(tmp_path, exist_ok=True)
    monkeypatch.setattr(videos.settings, "OSS_ACCESS_KEY_ID", "fake-ak")
    monkeypatch.setattr(videos.settings, "OSS_ACCESS_KEY_SECRET", "fake-sk")
    return tmp_path


def _make_video(db, obs_key):
    from app.models.course import Course, Video

    course = Course(id=str(uuid.uuid4()), title="回退测试课程", status="published")
    video = Video(id=str(uuid.uuid4()), course_id=course.id,
                  title="片段", obs_key=obs_key, duration=10, sort_order=0)
    db.add_all([course, video])
    db.commit()
    return course.id


class TestUploadRelay:
    def test_falls_back_to_local_disk_when_oss_fails(self, client, admin_headers, local_video_dir, monkeypatch):
        monkeypatch.setattr(videos, "_get_oss_bucket", lambda: _FakeBucket(fail=True))
        res = client.post("/api/videos/upload-relay", headers=admin_headers,
                          files={"file": ("clip.mp4", b"abcd" * 1024, "video/mp4")})
        assert res.status_code == 200
        body = res.json()
        assert body["stored"] == "local"
        assert body["file_size"] == 4096
        saved = local_video_dir / body["filename"]
        assert saved.exists() and saved.stat().st_size == 4096

    def test_prefers_oss_and_removes_local_copy(self, client, admin_headers, local_video_dir, monkeypatch):
        fake = _FakeBucket()
        monkeypatch.setattr(videos, "_get_oss_bucket", lambda: fake)
        res = client.post("/api/videos/upload-relay", headers=admin_headers,
                          files={"file": ("clip.mp4", b"abcd" * 100, "video/mp4")})
        assert res.status_code == 200
        body = res.json()
        assert body["stored"] == "oss"
        assert fake.uploaded == [f"{videos.OSS_VIDEO_PREFIX}{body['filename']}"]
        # OSS 成功后本地副本必须清掉，防双份存储
        assert not (local_video_dir / body["filename"]).exists()

    def test_rejects_unsupported_extension(self, client, admin_headers, local_video_dir):
        res = client.post("/api/videos/upload-relay", headers=admin_headers,
                          files={"file": ("evil.txt", b"hello", "text/plain")})
        assert res.status_code == 400

    def test_requires_admin(self, client, student_headers, local_video_dir):
        res = client.post("/api/videos/upload-relay", headers=student_headers,
                          files={"file": ("clip.mp4", b"abcd", "video/mp4")})
        assert res.status_code == 403


class TestStreamLocalFallback:
    def test_stream_serves_local_file_with_range(self, client, admin_token, db, local_video_dir):
        obs_key = f"local-{uuid.uuid4().hex[:8]}.mp4"
        _make_video(db, obs_key)
        payload = bytes(range(64))
        (local_video_dir / obs_key).write_bytes(payload)

        # 无 Range → 200 全量
        r = client.get(f"/api/videos/stream/{obs_key}?token={admin_token}")
        assert r.status_code == 200
        assert r.content == payload
        assert r.headers.get("accept-ranges") == "bytes"

        # 有 Range → 206 分段（video 元素拖动进度条依赖）
        r = client.get(f"/api/videos/stream/{obs_key}?token={admin_token}",
                       headers={"Range": "bytes=10-19"})
        assert r.status_code == 206
        assert r.content == payload[10:20]
        assert r.headers["content-range"] == f"bytes 10-19/{len(payload)}"

        # 越界 → 416
        r = client.get(f"/api/videos/stream/{obs_key}?token={admin_token}",
                       headers={"Range": "bytes=1000-2000"})
        assert r.status_code == 416

    def test_stream_oss_redirect_preserved(self, client, admin_token, db, local_video_dir, monkeypatch):
        """本地没有对象时仍走 OSS 302 签名跳转（生产主链路不回归破坏）"""
        obs_key = f"oss-{uuid.uuid4().hex[:8]}.mp4"
        _make_video(db, obs_key)
        monkeypatch.setattr(videos, "_get_oss_bucket", lambda: _FakeBucket(exists=True))
        r = client.get(f"/api/videos/stream/{obs_key}?token={admin_token}", follow_redirects=False)
        assert r.status_code in (302, 307)
        assert "oss.example" in r.headers["location"]

    def test_stream_404_when_nowhere_and_oss_broken(self, client, admin_token, db, local_video_dir, monkeypatch):
        """OSS 探测异常且本地无文件：404 而不是 500"""
        obs_key = f"gone-{uuid.uuid4().hex[:8]}.mp4"
        _make_video(db, obs_key)
        monkeypatch.setattr(videos, "_get_oss_bucket", lambda: _FakeBucket(fail=True))
        r = client.get(f"/api/videos/stream/{obs_key}?token={admin_token}")
        assert r.status_code == 404


class TestPlayUrlFallback:
    def test_play_url_local_returns_null_url_flag(self, client, admin_headers, db, local_video_dir):
        obs_key = f"local-{uuid.uuid4().hex[:8]}.mp4"
        _make_video(db, obs_key)
        (local_video_dir / obs_key).write_bytes(b"x" * 16)
        r = client.get(f"/api/videos/play-url/{obs_key}", headers=admin_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["url"] is None and body["local"] is True

    def test_play_url_signed_for_oss(self, client, admin_headers, db, local_video_dir, monkeypatch):
        obs_key = f"oss-{uuid.uuid4().hex[:8]}.mp4"
        _make_video(db, obs_key)
        monkeypatch.setattr(videos, "_get_oss_bucket", lambda: _FakeBucket(exists=True))
        r = client.get(f"/api/videos/play-url/{obs_key}", headers=admin_headers)
        assert r.status_code == 200
        assert "oss.example" in r.json()["url"]


def test_delete_oss_object_also_removes_local(client, admin_headers, local_video_dir, monkeypatch):
    """删除视频连带清理本地回退文件（即使 OSS 凭证不可用也返回成功）"""
    obs_key = f"del-{uuid.uuid4().hex[:8]}.mp4"
    path = local_video_dir / obs_key
    path.write_bytes(b"x" * 8)
    monkeypatch.setattr(videos, "_get_oss_bucket", lambda: _FakeBucket(fail=True))
    assert videos.delete_oss_object(obs_key) is True
    assert not path.exists()
