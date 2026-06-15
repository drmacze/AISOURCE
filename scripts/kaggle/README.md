# DLavie OS — Kaggle Fine-Tuning Setup

## File di folder ini

| File | Fungsi |
|---|---|
| `export_and_upload.py` | Export dataset dari DLavie OS → upload ke Kaggle |
| `dlavie_finetune_notebook.ipynb` | Notebook Kaggle siap pakai untuk LoRA fine-tuning |
| `export/` | Folder output file JSONL hasil export |

## Cara pakai

### Step 1 — Export & upload dataset
```bash
python3 scripts/kaggle/export_and_upload.py
```

### Step 2 — Buka notebook di Kaggle
1. Buka kaggle.com → **Create** → **New Notebook**
2. Klik **File** → **Import Notebook** → upload `dlavie_finetune_notebook.ipynb`
3. Di panel kanan → **Add data** → pilih dataset `dlavie-training-dataset`
4. **Session options** → Accelerator → **GPU T4 x2**
5. Jalankan cell satu per satu

## Prasyarat
- Verifikasi nomor HP di kaggle.com/settings
- `KAGGLE_USERNAME` dan `KAGGLE_KEY` sudah di Replit Secrets
