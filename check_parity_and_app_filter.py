import pickle
import numpy as np
import pandas as pd
from sklearn.metrics import balanced_accuracy_score

from pose_features import analyze_landmarks, extract_landmarks_from_video

art = pickle.load(open("model_e02.pkl", "rb"))
cols = art["feat_cols"]
model = art["model"]
conf_thr = float(art["conf_thr"])
df = pd.read_csv("inventory_cached.csv", dtype=str)


def eval_out(o):
    if o is None or not o["cycles"]:
        return np.nan, 0.0, 0.0
    X = pd.DataFrame([[c["features"][k] for k in cols] for c in o["cycles"]], columns=cols)
    p = float(model.predict_proba(X)[:, 1].mean())
    dur = float(o["t_u"][-1] - o["t_u"][0]) if len(o["t_u"]) >= 2 else 0.0
    return p, float(o["det_pct"]), dur


print("=== 1. PARITY CHECK (12 cells: 1 video per vol x folder) ===")
sample12 = df.groupby(["vol", "folder"], as_index=False).head(1)
max_diff = 0.0
for _, r in sample12.iterrows():
    d = np.load(r["npz"])
    p_train, _, _ = eval_out(analyze_landmarks(d["t"], d["lm_px"], d["hw"], hand_mode="auto_video"))
    t, lm, hw, _ = extract_landmarks_from_video(r["path"], step=2)
    o_app = analyze_landmarks(t, lm, hw, hand_mode="auto_video")
    assert "chosen_hand" in o_app and "t_real" in o_app, "Missing keys in analyze_landmarks!"
    p_app, _, _ = eval_out(o_app)
    diff = abs(p_train - p_app)
    max_diff = max(max_diff, diff)
    print(f"  {r['vol']}_{r['folder']:10s} | p_train={p_train:.4f} vs p_app={p_app:.4f} | diff={diff:.2e}")
print(f"Max diff across 12 cells: {max_diff:.2e}")

print("\n=== 2. APP STRICT FILTER PASS RATE (det >= 50% & dur >= 3s) ===")
for split_name in ("Train", "Test"):
    sub = df[df["split"] == split_name]
    ys, ps, pass_pose, pass_both = [], [], [], []
    for _, r in sub.iterrows():
        d = np.load(r["npz"])
        p, det_pct, dur = eval_out(analyze_landmarks(d["t"], d["lm_px"], d["hw"], hand_mode="auto_video"))
        y = 1 if r["folder"] == "Complete" else 0
        ok_p = (not np.isnan(p)) and (det_pct >= 50.0) and (dur >= 3.0)
        ok_b = ok_p and (max(p, 1.0 - p) >= conf_thr)
        ys.append(y); ps.append(p); pass_pose.append(ok_p); pass_both.append(ok_b)

    ys, ps = np.array(ys), np.array(ps)
    pass_pose, pass_both = np.array(pass_pose), np.array(pass_both)
    pred = (ps >= 0.5).astype(int)
    ba_b = balanced_accuracy_score(ys[pass_both], pred[pass_both]) if len(np.unique(ys[pass_both])) == 2 else np.nan
    print(f"  {split_name:5s} (N={len(sub):3d}) | pass pose(>=50%,>=3s): {pass_pose.sum():3d}/{len(sub)} ({pass_pose.mean()*100:.1f}%) | "
          f"pass pose+conf(>={conf_thr:.2f}): {pass_both.sum():3d}/{len(sub)} ({pass_both.mean()*100:.1f}%) | BA={ba_b:.3f}")