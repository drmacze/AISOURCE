#!/usr/bin/env python3
"""
DLavie OS — Export dataset ke JSONL + Upload ke Kaggle
Jalankan dari root workspace:
  python3 scripts/kaggle/export_and_upload.py
"""

import os
import json
import urllib.request
import urllib.error
import subprocess
from pathlib import Path
from datetime import datetime

API_BASE   = os.environ.get("DLAVIE_API_URL", "http://localhost:3000")
DATASET_ID = int(os.environ.get("DLAVIE_DATASET_ID", "1"))
OUT_DIR    = Path("scripts/kaggle/export")
OUT_DIR.mkdir(parents=True, exist_ok=True)

KAGGLE_USER = os.environ.get("KAGGLE_USERNAME", "")


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def export_dataset(dataset_id: int) -> Path:
    print(f"[1/3] Mengambil info dataset #{dataset_id} ...")
    info = fetch_json(f"{API_BASE}/api/training-datasets/{dataset_id}")
    name = info.get("name", f"dataset-{dataset_id}")
    total = info.get("sampleCount", 0)
    print(f"      Nama   : {name}")
    print(f"      Samples: {total}")

    print(f"[2/3] Download semua samples ...")
    all_samples = []
    limit  = 500
    offset = 0
    while True:
        data = fetch_json(
            f"{API_BASE}/api/training-datasets/{dataset_id}/samples"
            f"?limit={limit}&offset={offset}"
        )
        batch = data.get("samples", [])
        if not batch:
            break
        for s in batch:
            inp = (s.get("input") or "").strip()
            out = (s.get("output") or "").strip()
            if not inp or not out:
                continue
            # Buang output yang berisi base64/JSON raw (sampah)
            if out.startswith("{") and len(out) > 500:
                continue
            if "\\n" in out and len(out) > 300:
                continue
            all_samples.append({
                "input":  inp,
                "output": out,
                "source": s.get("source", ""),
            })
        offset += limit
        print(f"      Downloaded {offset}/{total} ...", end="\r")
        if offset >= total:
            break

    print(f"\n      Valid samples setelah filter: {len(all_samples)}")

    ts   = datetime.now().strftime("%Y%m%d_%H%M")
    path = OUT_DIR / f"dataset_{ts}.jsonl"
    with open(path, "w", encoding="utf-8") as f:
        for s in all_samples:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")

    print(f"      Disimpan ke: {path}")
    return path


def upload_to_kaggle(jsonl_path: Path):
    if not KAGGLE_USER:
        print("[3/3] ⚠️  KAGGLE_USERNAME tidak ditemukan — skip upload")
        print("      File siap di:", jsonl_path)
        return

    dataset_slug = "dlavie-training-dataset"
    dataset_dir  = OUT_DIR / "kaggle_upload"
    dataset_dir.mkdir(exist_ok=True)

    # Salin JSONL ke folder upload
    import shutil
    dest = dataset_dir / "dataset.jsonl"
    shutil.copy(jsonl_path, dest)

    # Buat dataset-metadata.json
    meta = {
        "title": "DLavie OS Training Dataset",
        "id": f"{KAGGLE_USER}/{dataset_slug}",
        "licenses": [{"name": "CC0-1.0"}],
    }
    with open(dataset_dir / "dataset-metadata.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[3/3] Mengupload ke Kaggle sebagai {KAGGLE_USER}/{dataset_slug} ...")

    # Cek apakah dataset sudah ada
    check = subprocess.run(
        ["python3", "-m", "kaggle", "datasets", "status",
         f"{KAGGLE_USER}/{dataset_slug}"],
        capture_output=True, text=True
    )

    if check.returncode == 0:
        # Update versi baru
        result = subprocess.run(
            ["python3", "-m", "kaggle", "datasets", "version",
             "-p", str(dataset_dir),
             "-m", f"Auto-update {datetime.now().strftime('%Y-%m-%d %H:%M')}"],
            capture_output=True, text=True
        )
    else:
        # Buat dataset baru
        result = subprocess.run(
            ["python3", "-m", "kaggle", "datasets", "create",
             "-p", str(dataset_dir)],
            capture_output=True, text=True
        )

    if result.returncode == 0:
        print(f"      ✅ Upload berhasil!")
        print(f"      URL: https://kaggle.com/datasets/{KAGGLE_USER}/{dataset_slug}")
    else:
        print(f"      ⚠️  Upload gagal: {result.stderr or result.stdout}")
        print(f"      File JSONL tetap tersedia di: {jsonl_path}")
        print(f"      Upload manual: kaggle.com → Datasets → New Dataset")


if __name__ == "__main__":
    try:
        jsonl_path = export_dataset(DATASET_ID)
        upload_to_kaggle(jsonl_path)
        print()
        print("✅ Selesai! File JSONL siap dipakai di Kaggle Notebook.")
    except Exception as e:
        print(f"❌ Error: {e}")
        raise
