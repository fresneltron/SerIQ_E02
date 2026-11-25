import pathlib
import pickle
import sys
import time
import warnings
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_p
from mediapipe.tasks.python import vision
import numpy as np
import pandas as pd
from pose_features import analyze_landmarks

warnings.filterwarnings("ignore")
IDX = [11, 12, 13, 14, 15, 16, 19, 20]
REC_SEC = 10.0
ART = pickle.load(open("model_e02.pkl", "rb"))
FEAT_COLS = ART["feat_cols"]


def load(src):
    if src == "cam":
        cap = cv2.VideoCapture(0, cv2.CAP_DSHOW) if "dshow" in sys.argv else cv2.VideoCapture(0)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        # Живой предпросмотр ДО старта, чтобы спокойно выставить ракурс (пробел/Enter в окне или Enter в консоли? Лучше нажмите любую клавишу В ОКНЕ камеры!)
        while True:
            ok, f = cap.read()
            if not ok:
                break
            disp = cv2.flip(f, 1)
            cv2.putText(disp, "Position yourself. Press SPACE in this window to start (10s)",
                        (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 220, 0), 2)
            cv2.imshow("SerIQ Camera Check", disp)
            key = cv2.waitKey(1) & 0xFF
            if key in (13, 32):  # Enter или Пробел
                break

        fr, ts, t0 = [], [], time.perf_counter()
        while True:
            el = time.perf_counter() - t0
            if el >= REC_SEC:
                break
            ok, f = cap.read()
            if not ok:
                break
            fr.append(f)
            ts.append(el)
            disp = cv2.flip(f, 1)
            cv2.putText(disp, f"REC: {REC_SEC - el:.1f}s left (do 3-4 reps)",
                        (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            cv2.imshow("SerIQ Camera Check", disp)
            cv2.waitKey(1)
        cap.release()
        cv2.destroyAllWindows()

        dt = np.diff(ts) * 1000
        fps = len(fr) / ts[-1]
        print(f"[CAM] кадров={len(fr)} реальный FPS={fps:.1f} интервал мс: med={np.median(dt):.0f} p95={np.percentile(dt,95):.0f} max={dt.max():.0f}")
        h, w = fr[0].shape[:2]
        vw = cv2.VideoWriter("diag_cam.avi", cv2.VideoWriter_fourcc(*"MJPG"), fps, (w, h))
        for f in fr:
            vw.write(f)
        vw.release()
        return fr, np.array(ts)

    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 1 or fps > 120:
        fps = 30.0
    fr = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        fr.append(f)
    cap.release()
    print(f"[VIDEO] {src} кадров={len(fr)} fps={fps:.1f} размер={fr[0].shape[1]}x{fr[0].shape[0]}")
    return fr, np.arange(len(fr)) / fps


def landmarks(frames, ts, step):
    b = pathlib.Path("pose_landmarker_full.task").read_bytes()
    o = vision.PoseLandmarkerOptions(
        base_options=mp_p.BaseOptions(model_asset_buffer=b),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.2,
        min_pose_presence_confidence=0.2,
        min_tracking_confidence=0.2,
    )
    sel = list(range(0, len(frames), step))
    out = np.full((len(sel), 8, 3), np.nan)
    t, inf, last = [], [], -1
    h, w = 480, 640
    with vision.PoseLandmarker.create_from_options(o) as det:
        for j, i in enumerate(sel):
            f = frames[i]
            h0, w0 = f.shape[:2]
            if w0 > 640:
                f = cv2.resize(f, (640, int(h0 * 640 / w0)))
            h, w = f.shape[:2]
            ms = max(int(ts[i] * 1000), last + 1)
            last = ms
            a = time.perf_counter()
            r = det.detect_for_video(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(f, cv2.COLOR_BGR2RGB)), ms
            )
            inf.append((time.perf_counter() - a) * 1000)
            t.append(ts[i])
            if r.pose_landmarks:
                lm = r.pose_landmarks[0]
                for k, ix in enumerate(IDX):
                    out[j, k] = (lm[ix].x * w, lm[ix].y * h, lm[ix].visibility)
    return np.array(t), out, (h, w), np.array(inf)


def report(name, t, lm, hw, inf):
    det = 100 * np.mean(~np.isnan(lm[:, 0, 0]))
    print(f"--- {name}: N={len(t)} eff.FPS={(len(t)-1)/max(1e-6, t[-1]-t[0]):.1f} det={det:.0f}% инференс={np.median(inf):.0f} мс hw={hw}")
    for s, (e, w_) in (("L", (2, 4)), ("R", (3, 5))):
        vis = np.minimum(lm[:, e, 2], lm[:, w_, 2])
        vx = lm[:, w_, 0] - lm[:, e, 0]
        vy = lm[:, w_, 1] - lm[:, e, 1]
        th = np.degrees(np.arctan2(-vy, np.abs(vx) + 1e-6))
        p = np.nanpercentile(th, [5, 50, 95])
        print(f"  {s}: vis med={np.nanmedian(vis):.2f} p20={np.nanpercentile(vis,20):.2f} | "
              f"theta p5/p50/p95={p[0]:.0f}/{p[1]:.0f}/{p[2]:.0f} | предплечье px med={np.nanmedian(np.hypot(vx,vy)):.0f}")
    res = analyze_landmarks(t, lm, hw, "auto_video")
    if res is None:
        print("  analyze: None (отброшено)")
        return
    X = pd.DataFrame([[c["features"][k] for k in FEAT_COLS] for c in res["cycles"]], columns=FEAT_COLS)
    probs = ART["model"].predict_proba(X)[:, 1]
    rngs = [round(c["features"]["th_rng"], 1) for c in res["cycles"]]
    mins = [round(c["features"]["th_min"], 1) for c in res["cycles"]]
    print(f"  hand={res['chosen_hand']} det_clean={res['det_pct']:.0f}% cycles={len(res['cycles'])} "
          f"th_rng={rngs} th_min={mins} prob_Complete={np.round(probs, 3).tolist()} mean_p={probs.mean():.3f}")


if __name__ == "__main__":
    frames, ts = load(sys.argv[1])
    for step in (1, 2, 3):
        report(f"step={step}", *landmarks(frames, ts, step))