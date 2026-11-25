import os
os.environ["GLOG_minloglevel"] = "3"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import pathlib
import time
import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

MODEL_BYTES = pathlib.Path("pose_landmarker_full.task").read_bytes()
CACHE_DIR = pathlib.Path("cache_e02")
CACHE_DIR.mkdir(exist_ok=True)

# 0:L_sh(11), 1:R_sh(12), 2:L_el(13), 3:R_el(14), 4:L_wr(15), 5:R_wr(16), 6:L_idx(19), 7:R_idx(20)
IDX = [11, 12, 13, 14, 15, 16, 19, 20]

df = pd.read_csv("inventory.csv", dtype=str)
df["suspect"] = df["folder"] != df["name_label"]

STEP = 2
t_start = time.perf_counter()
n_total = len(df)
records = []

for i, r in df.iterrows():
    stem = pathlib.Path(r["path"]).stem
    # Важно: включаем folder в имя файла, чтобы Complete и Incomplete у vol 04 не перезаписали друг друга
    out_npz = CACHE_DIR / f"{r['vol']}_{r['folder']}_{stem}.npz"

    if out_npz.exists():
        records.append({**r.to_dict(), "npz": str(out_npz)})
        print(f"[{i+1:3d}/{n_total}] SKIP (cached) {out_npz.name}")
        continue

    cap = cv2.VideoCapture(r["path"])
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 1 or fps > 120:
        fps = 30.0

    opts = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_buffer=MODEL_BYTES),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.2,
        min_pose_presence_confidence=0.2,
        min_tracking_confidence=0.2,
    )

    t_list, px_list, w_list = [], [], []
    hw = (0, 0)
    k, last_ts = 0, -1

    with vision.PoseLandmarker.create_from_options(opts) as det:
        while True:
            ok, fr = cap.read()
            if not ok:
                break
            k += 1
            if (k - 1) % STEP != 0:
                continue

            h, w = fr.shape[:2]
            hw = (h, w)
            rgb = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
            ts = max(last_ts + 1, int((k - 1) * (1000.0 / fps)))
            last_ts = ts

            res = det.detect_for_video(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts
            )
            t_list.append(ts / 1000.0)

            if res.pose_landmarks:
                lm = res.pose_landmarks[0]
                wlm = res.pose_world_landmarks[0] if res.pose_world_landmarks else lm
                px_arr = np.array([[lm[j].x * w, lm[j].y * h, lm[j].visibility] for j in IDX], dtype=np.float32)
                w_arr = np.array([[wlm[j].x, wlm[j].y, wlm[j].z] for j in IDX], dtype=np.float32)
            else:
                px_arr = np.full((len(IDX), 3), np.nan, dtype=np.float32)
                w_arr = np.full((len(IDX), 3), np.nan, dtype=np.float32)

            px_list.append(px_arr)
            w_list.append(w_arr)
    cap.release()

    t_arr = np.array(t_list, dtype=np.float32)
    lm_px = np.stack(px_list, axis=0) if px_list else np.zeros((0, len(IDX), 3), dtype=np.float32)
    lm_w = np.stack(w_list, axis=0) if w_list else np.zeros((0, len(IDX), 3), dtype=np.float32)
    det_pct = 100.0 * float(np.mean(~np.isnan(lm_px[:, 0, 0]))) if len(lm_px) else 0.0

    np.savez_compressed(
        out_npz,
        t=t_arr,
        lm_px=lm_px,
        lm_w=lm_w,
        hw=np.array(hw, dtype=np.int32),
        fps=np.float32(fps),
    )
    records.append({**r.to_dict(), "npz": str(out_npz)})

    elapsed = time.perf_counter() - t_start
    eta_m = (elapsed / (i + 1)) * (n_total - i - 1) / 60.0
    print(f"[{i+1:3d}/{n_total}] {out_npz.name:34s} | frames={len(t_arr):3d} det={det_pct:5.1f}% | ETA {eta_m:4.1f}m")

pd.DataFrame(records).to_csv("inventory_cached.csv", index=False)
print(f"\nDONE! 127 videos cached in {(time.perf_counter() - t_start)/60:.1f} min -> inventory_cached.csv")