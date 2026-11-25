import json
import pickle
import sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, confusion_matrix, f1_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from pose_features import FEAT_NO_DUR, FEAT_WITH_DUR, analyze_landmarks

df = pd.read_csv("inventory_cached.csv", dtype=str)
df["suspect"] = df["suspect"].astype(str).str.lower() == "true"


def build_cycle_df(sub_df, hand_mode: str):
    rows = []
    for vid_idx, r in sub_df.iterrows():
        d = np.load(r["npz"])
        out = analyze_landmarks(d["t"], d["lm_px"], d["hw"], hand_mode=hand_mode)
        if out is None:
            continue
        for c in out["cycles"]:
            rows.append({
                "video_id": f"{r['vol']}_{r['folder']}_{vid_idx}",
                "split": r["split"],
                "vol": r["vol"],
                "folder": r["folder"],
                "y": 1 if r["folder"] == "Complete" else 0,
                "suspect": bool(r["suspect"]),
                "cycle_id": c["cycle_id"],
                "det_pct": c["det_pct"],
                "pose_ok": c["pose_ok"],
                "hand": out["chosen_hand"],
                **c["features"],
            })
    return pd.DataFrame(rows)


def fit_baseline_thr(tr_df):
    best_thr, best_ba = 45.0, -1.0
    for thr in np.linspace(20, 75, 56):
        ba = balanced_accuracy_score(tr_df["y"], (tr_df["th_rng"] >= thr).astype(int))
        if ba > best_ba:
            best_ba, best_thr = ba, thr
    return float(best_thr)


def make_logreg():
    return make_pipeline(StandardScaler(), LogisticRegression(C=0.5, class_weight="balanced", max_iter=1000))


def make_rf():
    return RandomForestClassifier(
        n_estimators=300, max_depth=4, min_samples_leaf=3,
        class_weight="balanced", random_state=42
    )


def bootstrap_ci(y_true, y_pred, n_boot=2000, seed=42):
    rng = np.random.default_rng(seed)
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    bas = []
    for _ in range(n_boot):
        idx = rng.integers(0, len(y_true), len(y_true))
        if len(np.unique(y_true[idx])) < 2:
            continue
        bas.append(balanced_accuracy_score(y_true[idx], y_pred[idx]))
    return float(np.percentile(bas, 2.5)), float(np.percentile(bas, 97.5))


def eval_lovo(sub_df, feat_cols, label):
    vols = sorted(sub_df["vol"].unique())
    oof = {"y": [], "vol": [], "video_id": [], "pose_ok": [], "base": [], "lr_p": [], "rf_p": []}
    for v_val in vols:
        tr = sub_df[sub_df["vol"] != v_val]
        va = sub_df[sub_df["vol"] == v_val]

        thr = fit_baseline_thr(tr)
        pb = (va["th_rng"].values >= thr).astype(int)

        lr = make_logreg().fit(tr[feat_cols], tr["y"])
        pl = lr.predict_proba(va[feat_cols])[:, 1]

        rf = make_rf().fit(tr[feat_cols], tr["y"])
        pr = rf.predict_proba(va[feat_cols])[:, 1]

        oof["y"].extend(va["y"].tolist())
        oof["vol"].extend(va["vol"].tolist())
        oof["video_id"].extend(va["video_id"].tolist())
        oof["pose_ok"].extend(va["pose_ok"].tolist())
        oof["base"].extend(pb.tolist())
        oof["lr_p"].extend(pl.tolist())
        oof["rf_p"].extend(pr.tolist())

    odf = pd.DataFrame(oof)
    vdf = odf.groupby("video_id", as_index=False).agg(
        y=("y", "first"), pose_ok=("pose_ok", "any"),
        base=("base", "mean"), lr_p=("lr_p", "mean"), rf_p=("rf_p", "mean")
    )
    vdf["base_pred"] = (vdf["base"] >= 0.5).astype(int)
    vdf["lr_pred"] = (vdf["lr_p"] >= 0.5).astype(int)
    vdf["rf_pred"] = (vdf["rf_p"] >= 0.5).astype(int)

    print(f"\n=== {label} | cycles={len(odf)}, videos={len(vdf)} ===")
    res = {}
    for name, p_col in [("Baseline", "base_pred"), ("LogReg", "lr_pred"), ("RandomForest", "rf_pred")]:
        ba = balanced_accuracy_score(vdf["y"], vdf[p_col])
        f1 = f1_score(vdf["y"], vdf[p_col])
        lo, hi = bootstrap_ci(vdf["y"], vdf[p_col])
        cm = confusion_matrix(vdf["y"], vdf[p_col]).tolist()
        print(f"  {name:14s}: BA={ba:.3f} (95% CI [{lo:.3f}, {hi:.3f}]) | F1={f1:.3f} | CM={cm}")
        res[name] = {"BA": round(float(ba), 4), "CI95": [round(lo, 4), round(hi, 4)], "F1": round(float(f1), 4), "CM": cm}
    return odf, vdf, res


# ---------------- STAGE 1: ТОЛЬКО TRAIN (01-05) ----------------
train_inv = df[df["split"] == "Train"].copy()
train_video_hand = build_cycle_df(train_inv, hand_mode="auto_video")
train_frame_hand = build_cycle_df(train_inv, hand_mode="auto_frame")

# Ablation 1: одна рука на видео vs перескок по кадрам, без dur vs с dur
_, vdf_main, res_vid_nodur = eval_lovo(train_video_hand, FEAT_NO_DUR, "LOVO 01-05 | auto_video | NO dur")
_, _, res_vid_dur = eval_lovo(train_video_hand, FEAT_WITH_DUR, "LOVO 01-05 | auto_video | WITH dur")
_, _, res_frm_nodur = eval_lovo(train_frame_hand, FEAT_NO_DUR, "LOVO 01-05 | auto_frame | NO dur")

# Ablation 2: чистый эксперимент по 04_suspect (обучение на 01,02,03,05 -> прогноз на 04)
print("\n=== CHECK 04_suspect (trained ONLY on vols 01,02,03,05) ===")
tr_no04 = train_video_hand[train_video_hand["vol"] != "04"]
te_04 = train_video_hand[train_video_hand["vol"] == "04"]
rf_04 = make_rf().fit(tr_no04[FEAT_NO_DUR], tr_no04["y"])
te_04_v = te_04.assign(p=rf_04.predict_proba(te_04[FEAT_NO_DUR])[:, 1]).groupby(
    ["video_id", "folder", "suspect"], as_index=False
)["p"].mean()
te_04_v["pred_Complete"] = te_04_v["p"] >= 0.5
print(te_04_v.groupby(["folder", "suspect"]).agg(
    n_videos=("video_id", "count"),
    pred_as_Complete=("pred_Complete", "sum"),
    mean_prob=("p", "mean"),
).round(3))

# Выбираем модель и признаки (без dur по умолчанию, одна рука на видео)
FEAT_COLS = FEAT_NO_DUR
best_name = "RandomForest" if res_vid_nodur["RandomForest"]["BA"] >= res_vid_nodur["LogReg"]["BA"] else "LogReg"
p_col = "rf_p" if best_name == "RandomForest" else "lr_p"

# Подбор порога уверенности на уровне видео (единая единица оценки с датасетом)
probs_v = vdf_main[p_col].values
y_v = vdf_main["y"].values
pose_ok_v = vdf_main["pose_ok"].values
conf_v = np.maximum(probs_v, 1.0 - probs_v)
preds_v = (probs_v >= 0.5).astype(int)

thrs = np.linspace(0.50, 0.80, 13)
cov_list, ba_list = [], []
best_ct, best_ct_ba = 0.60, -1.0
print(f"\n=== CONFIDENCE THRESHOLD SWEEP ON LOVO 01-05 ({best_name}, video-level) ===")
for ct in thrs:
    mask = pose_ok_v & (conf_v >= ct)
    cov = float(np.mean(mask))
    if np.sum(mask) >= 10 and len(np.unique(y_v[mask])) == 2:
        ba = float(balanced_accuracy_score(y_v[mask], preds_v[mask]))
        if cov >= 0.70 and ba > best_ct_ba:
            best_ct_ba, best_ct = ba, float(ct)
    else:
        ba = np.nan
    cov_list.append(cov)
    ba_list.append(ba)
    print(f"  conf >= {ct:.2f} | accepted={cov*100:5.1f}% ({np.sum(mask):3d}/{len(mask)}) | BA={ba:.3f}")

CONF_THR = best_ct
print(f"Chosen confidence threshold (from LOVO, cov>=70%): {CONF_THR:.2f}")

fig, ax1 = plt.subplots(figsize=(7, 4.5))
ax1.plot(thrs, [b if not np.isnan(b) else None for b in ba_list], "o-", color="#1f77b4")
ax1.set_xlabel("Confidence threshold")
ax1.set_ylabel("Balanced Accuracy (accepted)", color="#1f77b4")
ax1.set_ylim(0.5, 1.0)
ax1.grid(True, alpha=0.3)
ax2 = ax1.twinx()
ax2.plot(thrs, [c * 100 for c in cov_list], "s--", color="#ff7f0e")
ax2.set_ylabel("Accepted videos (%)", color="#ff7f0e")
ax2.set_ylim(0, 105)
plt.axvline(CONF_THR, color="green", linestyle=":", label=f"Chosen={CONF_THR:.2f}")
plt.title(f"Confidence vs Coverage on LOVO 01-05 ({best_name})")
plt.tight_layout()
plt.savefig("fig_confidence_coverage.png", dpi=130)

# ---------------- ЗАМОК НА TEST 08 ----------------
if "--test" not in sys.argv:
    print("\n[LOCKED] Test 08 НЕ открыт. Изучите LOVO/ablation выше и запустите один раз с флагом --test.")
    sys.exit(0)

# ---------------- STAGE 2: ОДНОКРАТНОЕ ОТКРЫТИЕ TEST (08) ----------------
test_inv = df[df["split"] == "Test"].copy()
test_c = build_cycle_df(test_inv, hand_mode="auto_video")

thr_final = fit_baseline_thr(train_video_hand)
lr_final = make_logreg().fit(train_video_hand[FEAT_COLS], train_video_hand["y"])
rf_final = make_rf().fit(train_video_hand[FEAT_COLS], train_video_hand["y"])

test_c["base"] = (test_c["th_rng"].values >= thr_final).astype(int)
test_c["lr_p"] = lr_final.predict_proba(test_c[FEAT_COLS])[:, 1]
test_c["rf_p"] = rf_final.predict_proba(test_c[FEAT_COLS])[:, 1]

test_v = test_c.groupby("video_id", as_index=False).agg(
    y=("y", "first"), pose_ok=("pose_ok", "any"),
    base=("base", "mean"), lr_p=("lr_p", "mean"), rf_p=("rf_p", "mean")
)
test_v["base_pred"] = (test_v["base"] >= 0.5).astype(int)
test_v["lr_pred"] = (test_v["lr_p"] >= 0.5).astype(int)
test_v["rf_pred"] = (test_v["rf_p"] >= 0.5).astype(int)

print("\n" + "=" * 80)
print("OFFICIAL TEST (VOLUNTEER 08, N=20 VIDEOS) - OPENED ONCE")
print("=" * 80)
test_res = {}
for name, col, pr_col in [
    ("Baseline", "base_pred", None),
    ("LogReg", "lr_pred", "lr_p"),
    ("RandomForest", "rf_pred", "rf_p"),
]:
    ba = balanced_accuracy_score(test_v["y"], test_v[col])
    f1 = f1_score(test_v["y"], test_v[col])
    lo, hi = bootstrap_ci(test_v["y"], test_v[col])
    cm = confusion_matrix(test_v["y"], test_v[col]).tolist()

    acc_info = ""
    acc_ba, acc_cov = None, None
    if pr_col is not None:
        conf_t = np.maximum(test_v[pr_col].values, 1.0 - test_v[pr_col].values)
        mask_t = test_v["pose_ok"].values & (conf_t >= CONF_THR)
        acc_cov = float(np.mean(mask_t))
        if np.sum(mask_t) >= 2 and len(np.unique(test_v["y"].values[mask_t])) == 2:
            acc_ba = float(balanced_accuracy_score(test_v["y"].values[mask_t], test_v[col].values[mask_t]))
        acc_info = f" | Accepted(conf>={CONF_THR:.2f})={acc_cov*100:.0f}%, BA_acc={acc_ba if acc_ba is not None else 'nan'}"

    print(f"  {name:14s}: BA={ba:.3f} (95% CI [{lo:.3f}, {hi:.3f}]) | F1={f1:.3f} | CM={cm}{acc_info}")
    test_res[name] = {
        "BA": round(float(ba), 4),
        "CI95": [round(lo, 4), round(hi, 4)],
        "F1": round(float(f1), 4),
        "CM": cm,
        "accepted_pct": round(acc_cov * 100, 1) if acc_cov is not None else None,
        "accepted_BA": round(acc_ba, 4) if acc_ba is not None else None,
    }

# Дополнительный LOVO по всем 6 добровольцам (подписан отдельно от официального Test 08!)
all_c = pd.concat([train_video_hand, test_c], ignore_index=True)
_, _, res_6vol = eval_lovo(all_c, FEAT_COLS, "SUPPLEMENTARY LOVO (6 vols: 01-05 + 08)")

# Матрицы ошибок
fig, axes = plt.subplots(1, 2, figsize=(9, 4))
cm_lovo = np.array(res_vid_nodur[best_name]["CM"])
cm_test = np.array(test_res[best_name]["CM"])
for ax, cm, title in [
    (axes[0], cm_lovo, f"LOVO 01-05 ({best_name})\nBA={res_vid_nodur[best_name]['BA']:.3f}, F1={res_vid_nodur[best_name]['F1']:.3f}"),
    (axes[1], cm_test, f"Official Test 08 ({best_name})\nBA={test_res[best_name]['BA']:.3f}, F1={test_res[best_name]['F1']:.3f}"),
]:
    ax.imshow(cm, cmap="Blues")
    ax.set_xticks([0, 1]); ax.set_yticks([0, 1])
    ax.set_xticklabels(["Incomplete", "Complete"])
    ax.set_yticklabels(["Incomplete", "Complete"])
    ax.set_xlabel("Predicted"); ax.set_ylabel("True")
    ax.set_title(title, fontsize=10)
    for (r_i, c_i), val in np.ndenumerate(cm):
        ax.text(c_i, r_i, str(val), ha="center", va="center", fontsize=14,
                color="white" if val > cm.max() / 2 else "black")
plt.tight_layout()
plt.savefig("fig_confusion_matrices.png", dpi=130)

chosen_model = rf_final if best_name == "RandomForest" else lr_final
artifact = {
    "model_name": best_name,
    "model": chosen_model,
    "baseline_thr": thr_final,
    "conf_thr": CONF_THR,
    "feat_cols": FEAT_COLS,
    "metrics": {
        "lovo_auto_video_no_dur": res_vid_nodur,
        "lovo_auto_video_with_dur": res_vid_dur,
        "lovo_auto_frame_no_dur": res_frm_nodur,
        "official_test_08": test_res,
        "supplementary_lovo_6vol": res_6vol,
    },
}
with open("model_e02.pkl", "wb") as f:
    pickle.dump(artifact, f)

with open("metrics_report.json", "w", encoding="utf-8") as f:
    json.dump(artifact["metrics"], f, ensure_ascii=False, indent=2)

print("\nSaved: model_e02.pkl, metrics_report.json, fig_confusion_matrices.png, fig_confidence_coverage.png")