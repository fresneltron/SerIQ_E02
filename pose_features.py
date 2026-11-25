import os
os.environ["GLOG_minloglevel"] = "3"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import pathlib
import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
from scipy.ndimage import median_filter
from scipy.signal import find_peaks

# 0:L_sh(11), 1:R_sh(12), 2:L_el(13), 3:R_el(14), 4:L_wr(15), 5:R_wr(16), 6:L_idx(19), 7:R_idx(20)
IDX = [11, 12, 13, 14, 15, 16, 19, 20]

FEAT_NO_DUR = [
    "th_min",
    "th_p10",
    "th_p50",
    "th_p90",
    "th_rng",
    "th_drop",
    "th_std",
    "frac_below_25",
    "frac_below_35",
    "wy_rel_rng",
    "iy_rel_rng",
    "max_speed",
    "mean_abs_speed",
    "smooth_jerk",
]
FEAT_WITH_DUR = FEAT_NO_DUR + ["dur"]


def extract_landmarks_from_video(
    video_path: str,
    model_path: str = "pose_landmarker_full.task",
    step: int = 2,
    progress_cb=None,
):
    model_bytes = pathlib.Path(model_path).read_bytes()
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 1 or fps > 120:
        fps = 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    opts = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_buffer=model_bytes),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.2,
        min_pose_presence_confidence=0.2,
        min_tracking_confidence=0.2,
    )

    t_list, px_list = [], []
    hw = (480, 640)
    k, last_ts = 0, -1

    with vision.PoseLandmarker.create_from_options(opts) as det:
        while True:
            ok, fr = cap.read()
            if not ok:
                break
            k += 1
            if (k - 1) % step != 0:
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
                px_arr = np.array(
                    [[lm[j].x * w, lm[j].y * h, lm[j].visibility] for j in IDX],
                    dtype=np.float32,
                )
            else:
                px_arr = np.full((len(IDX), 3), np.nan, dtype=np.float32)

            px_list.append(px_arr)
            if progress_cb is not None and total_frames > 0:
                progress_cb(min(1.0, k / total_frames))

    cap.release()
    t_arr = np.array(t_list, dtype=np.float32)
    lm_px = np.stack(px_list, axis=0) if px_list else np.zeros((0, len(IDX), 3), dtype=np.float32)
    return t_arr, lm_px, hw, float(fps)


def pick_hand(lm_px: np.ndarray, hw) -> str:
    h, w = int(hw[0]), int(hw[1])
    min_dim = float(min(h, w))
    best, best_sc = "L", -1.0
    for s, (ei, wi) in (("L", (2, 4)), ("R", (3, 5))):
        dx = lm_px[:, wi, 0] - lm_px[:, ei, 0]
        dy = lm_px[:, wi, 1] - lm_px[:, ei, 1]
        flen = np.hypot(dx, dy)
        ok = (~np.isnan(flen)) & (flen >= 0.04 * min_dim)
        if np.sum(ok) < 8:
            ok = ~np.isnan(flen)
        if np.sum(ok) < 6:
            continue
        med_flen = max(float(np.median(flen[ok])), 0.04 * min_dim, 1.0)
        rx = float(np.percentile(dx[ok], 90) - np.percentile(dx[ok], 10))
        ry = float(np.percentile(dy[ok], 90) - np.percentile(dy[ok], 10))
        vis = np.minimum(lm_px[ok, ei, 2], lm_px[ok, wi, 2])
        sc = ((rx + ry) / med_flen) * (0.2 + float(np.nanmean(vis)))
        if sc > best_sc:
            best, best_sc = s, sc
    return best


def _segment_cycles(th_s: np.ndarray, fs: float = 15.0):
    n = len(th_s)
    if n < 12:
        return [(0, n)]

    valleys, _ = find_peaks(-th_s, prominence=15.0, distance=max(5, int(1.8 * fs)))
    if len(valleys) <= 1:
        return [(0, n)]

    valid_valleys = [int(valleys[0])]
    splits = []
    for v_next in valleys[1:]:
        v_prev = valid_valleys[-1]
        seg = th_s[v_prev : int(v_next) + 1]
        peak_rel = int(np.argmax(seg))
        peak_val = float(seg[peak_rel])
        if peak_val - max(float(th_s[v_prev]), float(th_s[int(v_next)])) >= 18.0:
            splits.append(v_prev + peak_rel)
            valid_valleys.append(int(v_next))

    if not splits:
        return [(0, n)]

    bounds = [0] + splits + [n]
    cycles = [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1) if bounds[i + 1] - bounds[i] >= 8]
    return cycles if cycles else [(0, n)]


def analyze_landmarks(t: np.ndarray, lm_px: np.ndarray, hw, hand_mode: str = "auto_video"):
    t = np.asarray(t, dtype=float)
    lm = np.asarray(lm_px, dtype=float)
    h, w = int(hw[0]), int(hw[1])
    min_dim = float(min(h, w))

    if len(t) < 8 or len(lm) < 8:
        return None

    sides = {}
    for s, (ei, wi, ii) in (("L", (2, 4, 6)), ("R", (3, 5, 7))):
        ex, ey, ev = lm[:, ei, 0], lm[:, ei, 1], lm[:, ei, 2]
        wx, wy, wv = lm[:, wi, 0], lm[:, wi, 1], lm[:, wi, 2]
        ix, iy, _ = lm[:, ii, 0], lm[:, ii, 1], lm[:, ii, 2]
        vx, vy = wx - ex, wy - ey
        flen = np.hypot(vx, vy)
        vis = np.minimum(ev, wv)
        theta = np.degrees(np.arctan2(-vy, np.abs(vx) + 1e-6))

        raw_ok = ~np.isnan(theta)
        geom_ok = raw_ok & (flen >= 0.04 * min_dim) & (theta >= -25.0)
        sides[s] = {
            "theta": theta, "vis": vis, "flen": flen,
            "wy": -wy, "iy": -iy, "raw_ok": raw_ok, "ok": geom_ok,
        }

    chosen_hand = hand_mode
    if hand_mode == "auto_video":
        chosen_hand = pick_hand(lm, hw)

    if chosen_hand in ("L", "R"):
        ok = sides[chosen_hand]["ok"]
        if np.sum(ok) < 8:
            ok = sides[chosen_hand]["raw_ok"]
        if np.sum(ok) < 6:
            return None
        theta = sides[chosen_hand]["theta"]
        vis = sides[chosen_hand]["vis"]
        wy = sides[chosen_hand]["wy"]
        iy = sides[chosen_hand]["iy"]
        flen = sides[chosen_hand]["flen"]
    elif hand_mode == "auto_frame":
        ok_L, ok_R = sides["L"]["ok"], sides["R"]["ok"]
        use_L = ok_L & ((~ok_R) | (sides["L"]["vis"] >= sides["R"]["vis"]))
        ok = ok_L | ok_R
        if np.sum(ok) < 10:
            rL, rR = sides["L"]["raw_ok"], sides["R"]["raw_ok"]
            use_L = rL & ((~rR) | (sides["L"]["vis"] >= sides["R"]["vis"]))
            ok = rL | rR
        if np.sum(ok) < 6:
            return None
        theta = np.where(use_L, sides["L"]["theta"], sides["R"]["theta"])
        vis = np.where(use_L, sides["L"]["vis"], sides["R"]["vis"])
        wy = np.where(use_L, sides["L"]["wy"], sides["R"]["wy"])
        iy = np.where(use_L, sides["L"]["iy"], sides["R"]["iy"])
        flen = np.where(use_L, sides["L"]["flen"], sides["R"]["flen"])
    else:
        raise ValueError(f"Unknown hand_mode: {hand_mode}")

    v_thr = min(0.12, float(np.percentile(vis[ok], 20)))
    kept = ok & (vis >= v_thr)
    if np.sum(kept) < 6:
        kept = ok

    det_pct = 100.0 * float(np.sum(kept)) / len(t)
    med_flen = max(float(np.median(flen[kept])), 0.04 * min_dim, 1.0)

    t_k = t[kept]
    th_k = median_filter(theta[kept], size=min(5, len(t_k)))
    wy_k = median_filter(wy[kept], size=min(5, len(t_k)))
    iy_k = median_filter(iy[kept], size=min(5, len(t_k)))

    fs = 15.0
    t_u = np.arange(t_k[0], t_k[-1] + 1e-6, 1.0 / fs)
    if len(t_u) < 8:
        return None
    th_u = np.interp(t_u, t_k, th_k)
    wy_u = np.interp(t_u, t_k, wy_k)
    iy_u = np.interp(t_u, t_k, iy_k)

    win = 7
    k_s = np.ones(win) / win
    th_s = np.convolve(np.pad(th_u, win // 2, mode="edge"), k_s, mode="valid")

    cycle_bounds = _segment_cycles(th_s, fs=fs)
    cycles = []
    for idx_c, (s_i, e_i) in enumerate(cycle_bounds, start=1):
        th_c = th_s[s_i:e_i]
        wy_c = wy_u[s_i:e_i]
        iy_c = iy_u[s_i:e_i]
        t_c = t_u[s_i:e_i]

        p10, p50, p90 = np.percentile(th_c, [10, 50, 90])
        wp10, wp90 = np.percentile(wy_c, [10, 90])
        ip10, ip90 = np.percentile(iy_c, [10, 90])
        dth = np.gradient(th_c, 1.0 / fs)
        ddth = np.gradient(dth, 1.0 / fs)

        in_seg = (t_k >= t_c[0]) & (t_k <= t_c[-1])
        n_real = int(np.sum(in_seg))

        feats = {
            "th_min": float(np.min(th_c)),
            "th_p10": float(p10),
            "th_p50": float(p50),
            "th_p90": float(p90),
            "th_rng": float(p90 - p10),
            "th_drop": float(np.max(th_c) - np.min(th_c)),
            "th_std": float(np.std(th_c)),
            "frac_below_25": float(np.mean(th_c < 25.0)),
            "frac_below_35": float(np.mean(th_c < 35.0)),
            "wy_rel_rng": float((wp90 - wp10) / med_flen),
            "iy_rel_rng": float((ip90 - ip10) / med_flen),
            "max_speed": float(np.percentile(np.abs(dth), 95)),
            "mean_abs_speed": float(np.mean(np.abs(dth))),
            "smooth_jerk": float(np.mean(np.abs(ddth))),
            "dur": float(t_c[-1] - t_c[0]),
        }

        cycles.append({
            "cycle_id": idx_c,
            "t_start": float(t_c[0]),
            "t_end": float(t_c[-1]),
            "n_real_frames": n_real,
            "det_pct": det_pct,
            "pose_ok": (det_pct >= 20.0) and (n_real >= 8),
            "features": feats,
        })

    return {
        "chosen_hand": chosen_hand,
        "det_pct": det_pct,
        "med_flen": med_flen,
        "t_u": t_u,
        "t_real": t_k,
        "th_s": th_s,
        "cycles": cycles,
    }