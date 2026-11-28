#!/usr/bin/env python3
"""Upload the built site to its environment folder, sending only what changed.

`aws s3 sync` compares size and modification time, and every build writes new files, so it
uploaded the whole site on each deploy. This compares each file's MD5 with the object's ETag
(the MD5 itself for a single-part upload under SSE-S3, which is how the site bucket stores
them), uploads the files that differ and deletes the objects the build no longer has.

Usage: site-sync.py <out dir> <bucket> <env>
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

# The Open Graph image has no extension, so the CLI would store it as octet-stream: a link
# preview needs image/png.
CONTENT_TYPES = {"opengraph-image": "image/png"}


def aws(*args, capture=True):
    result = subprocess.run(["aws", *args], check=True, text=True, capture_output=capture)
    return result.stdout


def local_files(out_dir):
    files = {}
    for root, _, names in os.walk(out_dir):
        for name in names:
            path = os.path.join(root, name)
            with open(path, "rb") as f:
                files[os.path.relpath(path, out_dir)] = hashlib.md5(f.read()).hexdigest()
    return files


def remote_objects(bucket, prefix):
    listing = aws("s3api", "list-objects-v2", "--bucket", bucket, "--prefix", prefix,
                  "--query", "Contents[].[Key,ETag]", "--output", "json")
    return {key[len(prefix):]: etag.strip('"') for key, etag in json.loads(listing) or []}


def main(out_dir, bucket, env):
    prefix = f"{env}/"
    local = local_files(out_dir)
    remote = remote_objects(bucket, prefix)

    changed = sorted(path for path, md5 in local.items() if remote.get(path) != md5)
    removed = sorted(set(remote) - set(local))

    # The changed files go up from a staging copy in one recursive cp, not one process per file;
    # the names in CONTENT_TYPES go in a second pass with their type.
    with tempfile.TemporaryDirectory() as staging:
        for path in changed:
            os.makedirs(os.path.dirname(os.path.join(staging, path)), exist_ok=True)
            shutil.copy2(os.path.join(out_dir, path), os.path.join(staging, path))
        if changed:
            target = f"s3://{bucket}/{prefix}"
            typed = [arg for name in CONTENT_TYPES for arg in ("--exclude", f"*{name}")]
            aws("s3", "cp", staging, target, "--recursive", "--only-show-errors", *typed,
                capture=False)
            for name, content_type in CONTENT_TYPES.items():
                aws("s3", "cp", staging, target, "--recursive", "--only-show-errors",
                    "--exclude", "*", "--include", f"*{name}", "--content-type", content_type,
                    capture=False)

    # delete-objects takes up to 1000 keys per call.
    for start in range(0, len(removed), 1000):
        batch = {"Objects": [{"Key": prefix + path} for path in removed[start:start + 1000]],
                 "Quiet": True}
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(batch, f)
        try:
            aws("s3api", "delete-objects", "--bucket", bucket, "--delete", f"file://{f.name}")
        finally:
            os.remove(f.name)

    print(f"{len(local)} files: {len(changed)} uploaded, {len(removed)} deleted, "
          f"{len(local) - len(changed)} unchanged")


if __name__ == "__main__":
    if len(sys.argv) != 4 or not shutil.which("aws"):
        sys.exit(__doc__)
    main(*sys.argv[1:])
