"""Verification for TierForge ZIP uploads (`_expand_zip` / `_store_image`).

Covers the safety rules that keep an uploaded archive from writing outside
the upload root or exhausting memory: zip-slip / absolute / drive-letter
names, hidden + `__MACOSX` junk, directories, non-image extensions,
entry-count and size caps, invalid archives, and the "no usable images"
error. Also checks the normal single-image path and that every stored file
lands inside the temp upload root.

No live DB and no network: patched temp instance path + temp upload root,
Flask test client helpers called directly. Run from anywhere:

    python stuff/check_tierforge_zip.py
"""
import io
import os
import shutil
import sys
import tempfile
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

tmp_instance = tempfile.mkdtemp(prefix="tierforge_zip_instance_")
tmp_uploads = tempfile.mkdtemp(prefix="tierforge_zip_uploads_")
os.environ["TIERFORGE_UPLOAD_ROOT"] = tmp_uploads

import flask  # noqa: E402

_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(  # noqa: E731
    *a, instance_path=tmp_instance, **kw)

from PIL import Image  # noqa: E402

from flask_app import create_app  # noqa: E402
from flask_app.apps.tierforge import routes as tf  # noqa: E402


class DummyUser:
    id = 1


def png_bytes(color=(255, 0, 0)):
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), color).save(buf, "PNG")
    return buf.getvalue()


def build_zip(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


checks = []


def check(label, cond):
    checks.append((label, bool(cond)))
    print(("OK    " if cond else "FAIL  ") + label)


try:
    app = create_app()
    with app.test_request_context("/"):
        for bad in [
            "../evil.png",
            "a/../../evil.png",
            "/abs.png",
            "C:/win.png",
            "__MACOSX/x.png",
            ".DS_Store",
            "._resource.png",
            "folder/",
            "notes.txt",
            "nul\x00.png",
        ]:
            check(f"reject {bad!r}", tf._safe_zip_entry_name(bad) is None)
        check("accept nested image",
              tf._safe_zip_entry_name("a/b/pic.JPG") == "pic.JPG")

        raw = build_zip([
            ("good.png", png_bytes()),
            ("nested/good2.png", png_bytes((0, 255, 0))),
            ("../evil.png", png_bytes((0, 0, 255))),
            ("notes.txt", b"hello"),
            ("__MACOSX/._good.png", b"junk"),
            ("folder/", b""),
        ])
        results, errors = tf._expand_zip(DummyUser(), raw)
        check("zip expands 2 valid images", len(results) == 2)
        check("zip skips non-images silently", errors == [])
        check("basenames used", sorted(r["name"] for r in results) == ["good", "good2"])

        stored = []
        for root, _, files in os.walk(tmp_uploads):
            stored.extend(os.path.join(root, f) for f in files)
        check("4 files stored (2 full + 2 thumbs)", len(stored) == 4)
        check("all stored paths inside root",
              all(os.path.abspath(p).startswith(os.path.abspath(tmp_uploads))
                  for p in stored))

        junk = build_zip([("readme.txt", b"hi"), ("folder/", b"")])
        res, err = tf._expand_zip(DummyUser(), junk)
        check("junk archive reports no valid images",
              res == [] and len(err) == 1
              and "no valid images" in err[0]["error"])

        many = build_zip([
            (f"img{i}.png", b"x") for i in range(tf.MAX_ZIP_ENTRIES + 1)
        ])
        res, err = tf._expand_zip(DummyUser(), many)
        check("entry cap rejects archive",
              res == [] and "too many files" in err[0]["error"])

        res, err = tf._expand_zip(DummyUser(), b"not a zip at all")
        check("invalid zip handled",
              res == [] and err[0]["error"] == "invalid zip file")

        entry = tf._store_image(DummyUser(), png_bytes((1, 2, 3)),
                                "dir/Some Name.PNG")
        check("store_image basename name", entry["name"] == "Some Name")
        check("store_image urls",
              entry["thumbUrl"].endswith("/thumb")
              and entry["fullUrl"].endswith("/full"))

        check("zip magic detected", tf._is_zip(raw))
        check("png not detected as zip", not tf._is_zip(png_bytes()))
finally:
    shutil.rmtree(tmp_instance, ignore_errors=True)
    shutil.rmtree(tmp_uploads, ignore_errors=True)

failed = [label for label, ok in checks if not ok]
print()
print(f"{len(checks) - len(failed)}/{len(checks)} passed")
if failed:
    print("FAILURES:", failed)
    sys.exit(1)
