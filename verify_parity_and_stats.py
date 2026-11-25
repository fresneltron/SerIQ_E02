import importlib.metadata
import pickle
import numpy as np
import pandas as pd
from sklearn.metrics import balanced_accuracy_score

from pose_features import FEAT_NO_DUR, analyze_landmarks, extract_landmarks_from_video

with open("model_e02.pkl", "rb") as f:
    art = pickle.load(f)
model = art["model"]
df = pd.read_csv("inventory_cached.csv", dtype=str)

# 1. Parity-тест на 5 видео (Train)
sample5 = df[df["split"] == "Train"].groupby("vol", as_index=False).first()
print("=== 1. PARITY TEST (video pipeline vs cached .npz) ===")
max_diff = 0.0
for _, r in sample5.iterrows():
    # Из видео (как в app.py)
    t_v, lm_v, hw_v, _ = extract_landmarks_from_video(r["path"], step=2)
    out_v = analyze_landmarks(t_v, lm_v, hw_v, hand_mode="auto_video")
    p_v = float(np.mean([
        model.predict_proba([[c["features"][k] for k in FEAT_NO_DUR]])[0, 1]
        for c in out_v["cycles"]
    ]))

    # Из кэша (как в train_and_eval.py)
    d = np.load(r["npz"])
    out_c = analyze_landmarks(d["t"], d["lm_px"], d["hw"], hand_mode="auto_video")
    p_c = float(np.mean([
        model.predict_proba([[c["features"][k] for k in FEAT_NO_DUR]])[0, 1]
        for c in out_c["cycles"]
    ]))

    diff = abs(p_v - p_c)
    max_diff = max(max_diff, diff)
    print(f"  {r['vol']}_{r['folder']:10s} | p_video={p_v:.5f} vs p_cache={p_c:.5f} | diff={diff:.2e}")
print(f"Max probability diff: {max_diff:.2e}")

# 2. Smoke-тест переключателей L / R / auto_video
print("\n=== 2. HAND MODE SMOKE TEST ===")
d0 = np.load(sample5.iloc[0]["npz"])
for hm in ("L", "R", "auto_video"):
    o = analyze_landmarks(d0["t"], d0["lm_px"], d0["hw"], hand_mode=hm)
    print(f"  hand_mode={hm:10s} -> chosen={o['chosen_hand']}, cycles={len(o['cycles'])}")

# 3. Paired bootstrap и CI на accepted Test 08 (без переобучения, просто оценка)
test_df = df[df["split"] == "Test"].copy()
y_t, p_lr_t, th_rng_t, pose_ok_t = [], [], [], []
for _, r in test_df.iterrows():
    d = np.load(r["npz"])
    out = analyze_landmarks(d["t"], d["lm_px"], d["hw"], hand_mode="auto_video")
    probs = [model.predict_proba([[c["features"][k] for k in FEAT_NO_DUR]])[0, 1] for c in out["cycles"]]
    rngs = [c["features"]["th_rng"] >= art["baseline_thr"] for c in out["cycles"]]
    y_t.append(1 if r["folder"] == "Complete" else 0)
    p_lr_t.append(float(np.mean(probs)))
    th_rng_t.append(float(np.mean(rngs)) >= 0.5)
    pose_ok_t.append(any(c["pose_ok"] for c in out["cycles"]))

y_t = np.array(y_t)
p_lr_t = np.array(p_lr_t)
pred_lr = (p_lr_t >= 0.5).astype(int)
pred_base = np.array(th_rng_t, dtype=int)
conf_t = np.maximum(p_lr_t, 1.0 - p_lr_t)
mask_acc = np.array(pose_ok_t) & (conf_t >= art["conf_thr"])

rng = np.random.default_rng(42)
diffs = []
acc_bas = []
for _ in range(2000):
    idx = rng.integers(0, len(y_t), len(y_t))
    if len(np.unique(y_t[idx])) == 2:
        diffs.append(balanced_accuracy_score(y_t[idx], pred_lr[idx]) - balanced_accuracy_score(y_t[idx], pred_base[idx]))
    idx_a = rng.integers(0, np.sum(mask_acc), np.sum(mask_acc))
    ya, pa = y_t[mask_acc][idx_a], pred_lr[mask_acc][idx_a]
    if len(np.unique(ya)) == 2:
        acc_bas.append(balanced_accuracy_score(ya, pa))

print("\n=== 3. TEST 08 STATISTICAL CHECKS ===")
print(f"  Paired diff BA(LogReg - Baseline): {np.mean(diffs):+.3f} (95% CI [{np.percentile(diffs, 2.5):+.3f}, {np.percentile(diffs, 97.5):+.3f}])")
print(f"  Accepted Test 08 (n={np.sum(mask_acc)}/20): BA={balanced_accuracy_score(y_t[mask_acc], pred_lr[mask_acc]):.3f} "
      f"(95% CI [{np.percentile(acc_bas, 2.5):.3f}, {np.percentile(acc_bas, 97.5):.3f}])")

# 4. Генерация requirements.txt с точными версиями
pkgs = ["numpy", "pandas", "scipy", "scikit-learn", "opencv-python", "mediapipe", "matplotlib", "streamlit"]
lines = [f"{p}=={importlib.metadata.version(p)}" for p in pkgs]
with open("requirements.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print("\n=== 4. Saved requirements.txt ===")
print("\n".join(lines))