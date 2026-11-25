"""Train browser-friendly classifiers for E01/E03/E04 and export all four models.

The organizer-provided Train/Test folders are respected. Video labels come from
the parent Complete/Incomplete folder; the first filename field is used only as
the volunteer ID for grouped validation.
"""

from __future__ import annotations

import json
import os
import pathlib
import pickle
import re
import time

os.environ.setdefault("GLOG_minloglevel", "3")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, confusion_matrix, f1_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


ROOT = pathlib.Path("An upper limb stroke rehabilitation exercise video/Exercise")
CACHE = pathlib.Path(".cache_mobile_models")
OUT = pathlib.Path("web/public/models")
HAND_MODEL = pathlib.Path("hand_landmarker.task")
POSE_MODEL = pathlib.Path("pose_landmarker_full.task")
SPECS = {
    "E01": {"folder": "1_Lifting an Object", "baseline": "wrist_y_range", "features": [
        "wrist_y_range", "wrist_y_change", "wrist_y_speed_p95", "wrist_x_range",
        "open_median", "open_range", "spread_median",
    ]},
    "E03": {"folder": "3_Lifting the Wrist", "baseline": "hand_axis_range", "features": [
        "hand_axis_range", "hand_axis_std", "hand_axis_change", "wrist_y_range",
        "open_median", "middle_extension_range", "spread_range",
    ]},
    "E04": {"folder": "4_Opening the Hand", "baseline": "open_median", "features": [
        "open_median", "open_p90", "open_range", "spread_median", "spread_p90",
        "thumb_extension_median", "finger_extension_median", "finger_extension_range",
    ]},
}


def hand_frame_features(landmarks):
    xy = np.asarray([[p.x, p.y] for p in landmarks], dtype=np.float64)
    wrist = xy[0]
    palm_len = max(float(np.linalg.norm(xy[9] - wrist)), 1e-4)
    palm_width = max(float(np.linalg.norm(xy[5] - xy[17])), 1e-4)
    tips = [4, 8, 12, 16, 20]
    ext = [float(np.linalg.norm(xy[t] - xy[m]) / palm_len) for t, m in
           [(8, 5), (12, 9), (16, 13), (20, 17)]]
    open_score = float(np.mean([np.linalg.norm(xy[t] - wrist) / palm_len for t in [8, 12, 16, 20]]))
    spread = float(np.linalg.norm(xy[8] - xy[20]) / palm_width)
    thumb = float(np.linalg.norm(xy[4] - wrist) / palm_len)
    axis = float(np.degrees(np.arctan2(-(xy[9, 1] - wrist[1]), abs(xy[9, 0] - wrist[0]) + 1e-6)))
    return {
        "wrist_x": float(wrist[0]), "wrist_y": float(wrist[1]),
        "open": open_score, "spread": spread, "thumb_extension": thumb,
        "finger_extension": float(np.mean(ext)), "hand_axis": axis,
        "middle_extension": ext[1],
    }


def summarize_track(rows, fps):
    keys = rows[0].keys()
    a = {k: np.asarray([r[k] for r in rows], dtype=float) for k in keys}
    y, x = a["wrist_y"], a["wrist_x"]
    times = a["time"]
    axis = np.unwrap(np.radians(a["hand_axis"])) * (180.0 / np.pi)
    features = {
        "wrist_y_range": float(np.percentile(y, 95) - np.percentile(y, 5)),
        "wrist_y_change": float(y[-1] - y[0]),
        "wrist_y_speed_p95": float(np.percentile(np.abs(np.diff(y) / np.maximum(np.diff(times), 1e-3)), 95)) if len(y) > 1 else 0.0,
        "wrist_x_range": float(np.percentile(x, 95) - np.percentile(x, 5)),
        "open_median": float(np.median(a["open"])),
        "open_p90": float(np.percentile(a["open"], 90)),
        "open_range": float(np.percentile(a["open"], 90) - np.percentile(a["open"], 10)),
        "spread_median": float(np.median(a["spread"])),
        "spread_p90": float(np.percentile(a["spread"], 90)),
        "spread_range": float(np.percentile(a["spread"], 90) - np.percentile(a["spread"], 10)),
        "thumb_extension_median": float(np.median(a["thumb_extension"])),
        "finger_extension_median": float(np.median(a["finger_extension"])),
        "finger_extension_range": float(np.percentile(a["finger_extension"], 90) - np.percentile(a["finger_extension"], 10)),
        "middle_extension_range": float(np.percentile(a["middle_extension"], 90) - np.percentile(a["middle_extension"], 10)),
        "hand_axis_range": float(np.percentile(axis, 95) - np.percentile(axis, 5)),
        "hand_axis_std": float(np.std(axis)),
        "hand_axis_change": float(axis[-1] - axis[0]),
    }
    return features


def extract_video(detector, path):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    if not 1.0 <= fps <= 120.0:
        fps = 30.0
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    rows, frame_idx, last_ts = [], 0, -1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_idx += 1
        if (frame_idx - 1) % 4:
            continue
        height, width = frame.shape[:2]
        scale = min(1.0, 640.0 / max(height, width))
        if scale < 1.0:
            frame = cv2.resize(frame, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        ts = max(last_ts + 1, int((frame_idx - 1) * 1000.0 / fps))
        last_ts = ts
        result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if result.hand_landmarks:
            tracks = result.hand_landmarks
            # Use the largest detected hand consistently when a second hand appears.
            lm = max(tracks, key=lambda pts: (max(p.x for p in pts) - min(p.x for p in pts)) *
                     (max(p.y for p in pts) - min(p.y for p in pts)))
            frame_features = hand_frame_features(lm)
            frame_features["time"] = (frame_idx - 1) / fps
            rows.append(frame_features)
    cap.release()
    if len(rows) < 8:
        return {"features": None, "detected": len(rows), "sampled": (n_frames + 3) // 4}
    return {"features": summarize_track(rows, fps / 4), "detected": len(rows), "sampled": (n_frames + 3) // 4}


def list_records(exercise_id, split):
    folder = ROOT / SPECS[exercise_id]["folder"]
    out = []
    for class_name, label in (("Incomplete", 0), ("Complete", 1)):
        for path in sorted((folder / class_name / split).glob("*.mp4")):
            match = re.match(r"(\d+)_", path.name)
            if not match:
                continue
            out.append({"path": str(path), "subject": match.group(1), "label": label,
                        "label_name": class_name, "split": split, "exercise": exercise_id})
    return out


def collect_features(exercise_id, split):
    cache_path = CACHE / f"{exercise_id}_hand_features_v3.json"
    CACHE.mkdir(exist_ok=True)
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    records = list_records(exercise_id, split)
    opts = vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(HAND_MODEL.resolve())),
        running_mode=vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.25,
        min_hand_presence_confidence=0.25,
        min_tracking_confidence=0.25,
    )
    changed = False
    with vision.HandLandmarker.create_from_options(opts) as detector:
        for i, row in enumerate(records, start=1):
            key = row["path"]
            if key not in cache:
                extracted = extract_video(detector, pathlib.Path(key))
                cache[key] = extracted
                changed = True
                cache_path.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")
            row.update(cache[key] or {})
            row.update(row.pop("features", {}) or {})
            print(f"[{exercise_id}] {i}/{len(records)} {pathlib.Path(key).name} | hand frames={row.get('detected', 0)}", flush=True)
    if changed:
        cache_path.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")
    return pd.DataFrame(records)


def make_logreg():
    return make_pipeline(StandardScaler(), LogisticRegression(C=0.5, class_weight="balanced", max_iter=1000))


def fit_baseline(train, feature):
    values = train[feature].to_numpy(dtype=float)
    labels = train.label.to_numpy(dtype=int)
    candidates = np.unique(np.quantile(values, np.linspace(0.05, 0.95, 41)))
    best = (-1.0, float(np.median(values)), "ge")
    for threshold in candidates:
        for direction in ("ge", "le"):
            pred = (values >= threshold).astype(int) if direction == "ge" else (values <= threshold).astype(int)
            ba = balanced_accuracy_score(labels, pred)
            if ba > best[0]:
                best = (float(ba), float(threshold), direction)
    return best[1], best[2]


def class_metrics(y, pred):
    return {
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1]).tolist(),
        "n": int(len(y)),
    }


def fit_oof(train, feat_cols):
    probabilities, labels, subjects, baseline_predictions = [], [], [], []
    baseline_feature = SPECS[train.exercise.iloc[0]]["baseline"]
    for subject in sorted(train["subject"].unique()):
        val = train[train.subject == subject]
        fit = train[train.subject != subject]
        if len(fit) < 4 or fit.label.nunique() < 2:
            continue
        model = make_logreg().fit(fit[feat_cols], fit.label)
        probabilities.extend(model.predict_proba(val[feat_cols])[:, 1].tolist())
        labels.extend(val.label.tolist())
        subjects.extend(val.subject.tolist())
        threshold, direction = fit_baseline(fit, baseline_feature)
        vals = val[baseline_feature].to_numpy(dtype=float)
        baseline_predictions.extend((vals >= threshold if direction == "ge" else vals <= threshold).astype(int).tolist())
    if len(set(labels)) < 2:
        raise ValueError("Grouped Train validation did not contain both classes")
    return np.asarray(labels), np.asarray(probabilities), subjects, np.asarray(baseline_predictions)


def pick_conf_threshold(y, p):
    conf = np.maximum(p, 1.0 - p)
    best = (0.50, -1.0)
    for threshold in np.arange(0.50, 0.901, 0.01):
        accepted = conf >= threshold
        if accepted.mean() < 0.70 or len(np.unique(y[accepted])) < 2:
            continue
        ba = balanced_accuracy_score(y[accepted], (p[accepted] >= 0.5).astype(int))
        if ba > best[1]:
            best = (float(threshold), float(ba))
    return best[0], best[1]


def eval_metrics(y, p, threshold):
    pred = (p >= 0.5).astype(int)
    accepted = np.maximum(p, 1.0 - p) >= threshold
    accepted_ba = None
    if accepted.any() and len(np.unique(y[accepted])) == 2:
        accepted_ba = float(balanced_accuracy_score(y[accepted], pred[accepted]))
    return {
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1]).tolist(),
        "accepted_coverage": float(accepted.mean()),
        "accepted_balanced_accuracy": accepted_ba,
        "n": int(len(y)),
    }


def export_existing_e02():
    with open("model_e02.pkl", "rb") as f:
        artifact = pickle.load(f)
    scaler = artifact["model"].named_steps["standardscaler"]
    lr = artifact["model"].named_steps["logisticregression"]
    OUT.mkdir(parents=True, exist_ok=True)
    payload = {
        "exerciseId": "E02", "modelType": "logreg", "features": artifact["feat_cols"],
        "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist(),
        "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0]),
        "confidenceThreshold": float(artifact["conf_thr"]),
        "status": "ready", "source": "existing E02 model_e02.pkl",
    }
    (OUT / "E02.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return payload


def train_one(exercise_id):
    train_df = collect_features(exercise_id, "Train")
    feature_names = SPECS[exercise_id]["features"]
    usable = train_df.dropna(subset=feature_names).copy()
    usable[feature_names] = usable[feature_names].astype(float)
    train = usable
    oof_y, oof_p, _, baseline_oof = fit_oof(train, feature_names)
    threshold, accepted_ba = pick_conf_threshold(oof_y, oof_p)
    final = make_logreg().fit(train[feature_names], train.label)
    cv = eval_metrics(oof_y, oof_p, threshold)
    cv_baseline = class_metrics(oof_y, baseline_oof)

    # Freeze the model and confidence threshold using Train/LOVO before opening Test.
    test_df = collect_features(exercise_id, "Test")
    test = test_df.dropna(subset=feature_names).copy()
    if len(test):
        test[feature_names] = test[feature_names].astype(float)
    test_metrics = None
    test_baseline_metrics = None
    if len(test) and test.label.nunique() == 2:
        test_p = final.predict_proba(test[feature_names])[:, 1]
        test_metrics = eval_metrics(test.label.to_numpy(), test_p, threshold)
        baseline_threshold, baseline_direction = fit_baseline(train, SPECS[exercise_id]["baseline"])
        baseline_values = test[SPECS[exercise_id]["baseline"]].to_numpy(dtype=float)
        baseline_test_predictions = (baseline_values >= baseline_threshold if baseline_direction == "ge" else baseline_values <= baseline_threshold).astype(int)
        test_baseline_metrics = class_metrics(test.label.to_numpy(), baseline_test_predictions)
    original_test = sum(len(list_records(exercise_id, "Test")) for _ in [0])
    accepted_test = int(test_metrics["accepted_coverage"] * len(test)) if test_metrics else 0
    metrics = {
        "exercise": exercise_id,
        "train_videos": int(len(list_records(exercise_id, "Train"))),
        "train_with_hand_landmarks": int(len(train)),
        "test_videos": int(original_test),
        "test_with_hand_landmarks": int(len(test)),
        "baseline_feature": SPECS[exercise_id]["baseline"],
        "baseline_leave_one_subject_out": cv_baseline,
        "logreg_leave_one_subject_out": cv,
        "cv_threshold": threshold,
        "cv_accepted_ba": accepted_ba,
        "official_test": test_metrics,
        "official_test_baseline": test_baseline_metrics,
    }
    scaler = final.named_steps["standardscaler"]
    lr = final.named_steps["logisticregression"]
    payload = {
        "exerciseId": exercise_id, "modelType": "logreg", "features": feature_names,
        "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist(),
        "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0]),
        "confidenceThreshold": threshold, "status": "ready",
        "landmarker": "hand_landmarker.task",
    }
    (OUT / f"{exercise_id}.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"\n{exercise_id}: CV BA={cv['balanced_accuracy']:.3f}, CV coverage={cv['accepted_coverage']:.2f}, Test={test_metrics}", flush=True)
    return metrics


def main():
    start = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)
    export_existing_e02()
    all_metrics = {"E02": "existing metrics_report.json; converted from pickle"}
    for exercise_id in ("E01", "E03", "E04"):
        all_metrics[exercise_id] = train_one(exercise_id)
    (OUT / "metrics.json").write_text(json.dumps(all_metrics, indent=2), encoding="utf-8")
    print(f"Finished in {(time.perf_counter() - start) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
