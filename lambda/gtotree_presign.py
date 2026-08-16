"""gtotree-presign — Lambda Function URL that mints presigned PUT URLs.

This is the GToTree counterpart of breseq-presign. It uses the SAME request /
response contract, so it slots into the same kind of Lambda Function URL the
BASIL web server uses. The GToTree React frontend (src/lib/gtotree-config.ts ->
uploadRun) calls it exactly like this:

Endpoint contract (single route, POST):
    POST   {"slug":"8fK2qPb4Xm",
            "files":[{"name":"genomeA.fna","content_type":"text/plain"},
                     {"name":"form-data.txt","content_type":"text/plain"}, ...]}
    ->     {"slug":"8fK2qPb4Xm","bucket":"<INPUT_BUCKET>",
            "entries":[{"file_name":"genomeA.fna",
                        "url":"https://s3...?...",
                        "headers":{"Content-Type":"text/plain"}}, ...]}

The browser then PUTs each file to its `url` with the returned `Content-Type`
header. Files land at  s3://<INPUT_BUCKET>/<slug>/<name>  — the flat-slug layout
the GToTree tower (gtotree_processing.py) scrapes.

Why presigned single-shot PUTs (not multipart): every per-run file is small and
the whole run is capped at 1 GB client-side, well under S3's 5 GB single-PUT
limit. No multipart bookkeeping needed.

Environment variables
---------------------
    INPUT_BUCKET           (required)  e.g. "midauthorbio-gtotree-input"
    AWS_REGION_NAME        (optional)  defaults to "us-east-2"
    URL_EXPIRES_SECONDS    (optional)  presigned URL TTL, default 3600
    ALLOWED_ORIGINS        (optional)  comma-separated allow-list of web origins,
                                       e.g. "https://main.dXXXX.amplifyapp.com,
                                             https://breseq.midauthorbio.com".
                                       Empty = reflect any Origin (dev only).
    MAX_FILES              (optional)  reject batches larger than this (default 200)

IAM: the execution role needs s3:PutObject on  arn:aws:s3:::<INPUT_BUCKET>/*.
"""
import base64
import json
import os
import re

import boto3
from botocore.config import Config


INPUT_BUCKET = os.environ["INPUT_BUCKET"]
REGION = os.environ.get("AWS_REGION_NAME", "us-east-2")
EXPIRES = int(os.environ.get("URL_EXPIRES_SECONDS", "3600"))
MAX_FILES = int(os.environ.get("MAX_FILES", "200"))
ALLOWED_ORIGINS = set(
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()
)

# Defensive file-name allow-list: letters, digits, dot, underscore, dash.
# (The frontend already sanitises names this way before sending them.)
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")

# Result-code slug allow-list. The frontend generates a 10-char Base58-style
# slug (letters + digits). We also tolerate '-' and '_' to be safe. This is
# more robust than str.isalnum(), which can behave oddly for non-ASCII input.
SAFE_SLUG = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

s3 = boto3.client(
    "s3",
    region_name=REGION,
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
)


def _cors(origin):
    """Reflect an allowed Origin (or any Origin when the allow-list is empty)."""
    if origin and (not ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
            "Vary": "Origin",
        }
    return {}


def _reply(status, headers, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **headers},
        "body": json.dumps(body) if not isinstance(body, str) else body,
    }


def lambda_handler(event, _context):
    headers_in = event.get("headers") or {}
    origin = headers_in.get("origin") or headers_in.get("Origin")
    method = (
        (event.get("requestContext", {}) or {})
        .get("http", {})
        .get("method", "POST")
    )
    cors = _cors(origin)

    # CORS preflight
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": cors, "body": ""}
    if method != "POST":
        return _reply(405, cors, {"error": f"method {method} not allowed"})

    # Lambda Function URLs deliver the request body as a string, and may set
    # isBase64Encoded=True (common for binary/JSON content types). Decode first.
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw).decode("utf-8")
        except Exception:
            return _reply(400, cors, {"error": "could not base64-decode body"})

    try:
        body = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return _reply(400, cors, {"error": "invalid JSON body"})
    if not isinstance(body, dict):
        return _reply(400, cors, {"error": "body must be a JSON object"})

    slug = str(body.get("slug") or "").strip()
    files = body.get("files") or []

    # Log what we actually parsed so 4xx causes are visible in CloudWatch.
    print(json.dumps({
        "msg": "presign_request",
        "slug": slug,
        "slug_len": len(slug),
        "file_count": len(files) if isinstance(files, list) else None,
        "isBase64Encoded": bool(event.get("isBase64Encoded")),
    }))

    # The GToTree result code is a flat slug (no subdirs).
    if not SAFE_SLUG.match(slug):
        return _reply(400, cors, {"error": f"bad slug: {slug!r}"})
    if not isinstance(files, list) or not files or len(files) > MAX_FILES:
        return _reply(400, cors, {"error": "bad files list"})

    entries = []
    seen = set()
    for f in files:
        name = (f.get("name") or "").strip()
        ctype = (f.get("content_type") or "application/octet-stream").strip()

        if (
            not name
            or ".." in name
            or "/" in name
            or "\\" in name
            or not SAFE_NAME.match(name)
        ):
            return _reply(400, cors, {"error": f"bad file name: {name}"})
        if name in seen:
            return _reply(400, cors, {"error": f"duplicate file name: {name}"})
        seen.add(name)

        key = f"{slug}/{name}"
        url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": INPUT_BUCKET, "Key": key, "ContentType": ctype},
            ExpiresIn=EXPIRES,
        )
        entries.append(
            {
                "file_name": name,
                "url": url,
                "headers": {"Content-Type": ctype},
            }
        )

    return _reply(200, cors, {"slug": slug, "bucket": INPUT_BUCKET, "entries": entries})
