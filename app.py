from collections import deque
import datetime
import json
import os
import pathlib
import pickle
import tempfile
import time
import traceback

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
import numpy as np
import pandas as pd
import streamlit as st

from pose_features import IDX, analyze_landmarks, extract_landmarks_from_video

st.set_page_config(page_title="SerIQ — E02 Rehabilitation Assistant", layout="wide")

st.markdown(
    """
    <style>
    .stApp, [data-testid="stMarkdownContainer"] p, [data-testid="stMarkdownContainer"] li,
    .stRadio label, .stSelectbox label { font-size: 19px !important; }
    h1 { font-size: 2.1rem !important; color: #0D2B4D; }
    h2, h3 { color: #103A66; }
    .stButton > button {
        font-size: 1.15rem !important;
        padding: 0.8rem 1.3rem !important;
        border-radius: 12px !important;
        font-weight: 600 !important;
    }
    .verdict-ok {
        background: #E6F2FF; border-left: 8px solid #1565C0;
        padding: 20px 24px; border-radius: 12px; color: #0D2B4D;
        font-size: 1.55rem; font-weight: 700; margin: 12px 0;
    }
    .verdict-check {
        background: #EEF4FB; border-left: 8px solid #5B8EC9;
        padding: 20px 24px; border-radius: 12px; color: #173A5E;
        font-size: 1.55rem; font-weight: 700; margin: 12px 0;
    }
    .safety-box {
        background: #E8F1FC; border: 1px solid #B8D4F5; border-left: 6px solid #1565C0;
        padding: 14px 18px; border-radius: 8px; color: #0D2B4D; font-size: 1rem;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

MODEL_PKL = pathlib.Path("model_e02.pkl")
POSE_TASK = pathlib.Path("pose_landmarker_full.task")
HISTORY_PATH = pathlib.Path("session_summary.json")

EXERCISES = {
    "E02": {
        "ru": "E02 — Разгибание локтя (Активно)",
        "kz": "E02 — Шынтақты жазу (Белсенді)",
        "active": True,
    },
    "E01": {
        "ru": "E01 — Поднятие предмета (Следующий этап)",
        "kz": "E01 — Затты көтеру (Келесі кезең)",
        "active": False,
    },
    "E03": {
        "ru": "E03 — Поднятие кисти (Следующий этап)",
        "kz": "E03 — Білезікті көтеру (Келесі кезең)",
        "active": False,
    },
    "E04": {
        "ru": "E04 — Раскрытие кисти (Следующий этап)",
        "kz": "E04 — Алақанды ашу (Келесі кезең)",
        "active": False,
    },
}

TEXTS = {
    "ru": {
        "title": "SerIQ — Помощник для домашней реабилитации",
        "subtitle": "Упражнение E02: Разгибание локтя",
        "missing_files": "Не найдены файлы модели (model_e02.pkl или pose_landmarker_full.task). Проверьте папку проекта.",
        "tab_train": "1. Занятие и сводка",
        "tab_report": "2. Для специалистов: метрики и ограничения",
        "safety": (
            "Важно: это помощник для тренировок, а не медицинский прибор. Он не ставит диагнозы и не заменяет врача. "
            "Если вы плохо себя чувствуете или появилась боль — прекратите занятие, обратитесь к врачу или вызовите скорую помощь по номеру <b>103</b>."
        ),
        "step1": "Шаг 1. Посмотрите видеоинструкцию",
        "instr_note": "Двигайтесь спокойно и в удобном темпе, как показано на видео.",
        "instr_none": "Запишите короткую видеоинструкцию instruction_e02.mp4 (30–60 сек) и положите в папку проекта.",
        "step2": "Шаг 2. Выберите способ занятия",
        "mode_opts": {"upload": "Загрузить видеозапись (с оценкой)", "cam": "Камера компьютера (трекер движения)"},
        "hand_adv": "Настройки руки (по умолчанию Авто)",
        "hand_opts": {"auto_video": "Авто (рекомендуется)", "L": "Левая рука", "R": "Правая рука"},
        "upload_lbl": "Выберите видеофайл с компьютера",
        "btn_analyze": "Проверить упражнение",
        "cam_note": "Демо-режим: сядьте боком к камере, чтобы целиком было видно предплечье. Показывает живой скелет и число циклов; автоматическая оценка обучена на видеозаписях пациентов.",
        "cam_sec": "Сколько секунд записывать",
        "btn_cam_start": "Включить камеру и начать (отсчёт 3–2–1)",
        "cam_err": "Не удалось открыть камеру этого компьютера. Используйте загрузку видео.",
        "cam_prep": "Приготовьтесь! Сядьте боком, чтобы рука была в кадре...",
        "cam_rec": "Идёт запись... Спокойно выполните упражнение.",
        "analyzing": "Проверяем запись...",
        "pose_fail": "Руку плохо видно или запись слишком короткая. Поставьте камеру сбоку, чтобы было видно предплечье при хорошем свете, и попробуйте ещё раз.",
        "verdict_ok": "Выполнено",
        "verdict_check": "Посмотрите видеоинструкцию ещё раз",
        "cam_done": "Запись с камеры завершена (демо-трекер)",
        "cam_done_hint": "Для автоматической оценки модели загрузите видеозапись в режиме «Загрузить видеозапись».",
        "approx_note": "Оценка приблизительная, сервис не заменяет врача. При ухудшении самочувствия звоните 103.",
        "cycles_found": "Распознано циклов",
        "details_exp": "Подробнее / Для специалистов (график, циклы и оценка)",
        "prob_lbl": "Оценка полного выполнения",
        "det_lbl": "Видимость руки (кадров)",
        "hand_used": "Выбранная рука",
        "plot_title": "Движение предплечья во времени (пропуски > 0.6 с скрыты)",
        "plot_y": "Наклон (град.)",
        "plot_x": "Время (сек)",
        "summary_hdr": "Локальная сводка занятия (видео не сохраняются)",
        "sum_cycles": "Распознано циклов",
        "sum_ok": "Выполнено (циклов)",
        "sum_check": "Повторить инструкцию (циклов)",
        "sum_sessions": "Проверено видео",
        "btn_clear": "Очистить сводку",
        "hist_time": "Время",
        "hist_cycles": "Циклов",
        "hist_ok": "Выполнено",
        "hist_check": "Инструкция",
        "hist_res": "Итог по видео",
        "col_cycle": "Цикл",
        "col_time": "Интервал (с)",
        "col_range": "Размах (°)",
        "col_min": "Мин. (°)",
        "col_prob": "Оценка (%)",
        "col_status": "Класс цикла",
        "limitations_hdr": "Честные выводы и ограничения решения",
    },
    "kz": {
        "title": "SerIQ — Үйдегі оңалтуға арналған көмекші",
        "subtitle": "E02 жаттығуы: Шынтақты жазу",
        "missing_files": "Модель файлдары табылмады (model_e02.pkl немесе pose_landmarker_full.task). Жоба папкасын тексеріңіз.",
        "tab_train": "1. Жаттығу және қорытынды",
        "tab_report": "2. Мамандарға: метрикалар және шектеулер",
        "safety": (
            "Маңызды: бұл жаттығуға арналған көмекші, медициналық құрал емес. Диагноз қоймайды және дәрігерді алмастырмайды. "
            "Өзіңізді нашар сезінсеңіз немесе ауырсыну пайда болса — жаттығуды тоқтатып, дәрігерге қаралыңыз не <b>103</b> нөміріне хабарласыңыз."
        ),
        "step1": "1-қадам. Бейненұсқаулықты қараңыз",
        "instr_note": "Бейнедегідей асықпай, өзіңізге ыңғайлы қарқынмен орындаңыз.",
        "instr_none": "Өзіңіздің қысқа instruction_e02.mp4 (30–60 сек) бейненұсқаулығыңызды жазып, жоба папкасына салыңыз.",
        "step2": "2-қадам. Жаттығу тәсілін таңдаңыз",
        "mode_opts": {"upload": "Бейнежазбаны жүктеу (бағалаумен)", "cam": "Компьютер камерасы (қозғалыс трекері)"},
        "hand_adv": "Қол баптауы (әдепкіде Авто)",
        "hand_opts": {"auto_video": "Авто (ұсынылады)", "L": "Сол қол", "R": "Оң қол"},
        "upload_lbl": "Компьютерден бейнефайлды таңдаңыз",
        "btn_analyze": "Жаттығуды тексеру",
        "cam_note": "Демо-режим: білек толық көрінуі үшін камераға қырынан отырыңыз. Тікелей қаңқа мен цикл санын көрсетеді.",
        "cam_sec": "Жазу ұзақтығы (сек)",
        "btn_cam_start": "Камераны қосып бастау (3–2–1 санау)",
        "cam_err": "Компьютер камерасы ашылмады. Бейне жүктеуді қолданыңыз.",
        "cam_prep": "Дайындалыңыз! Қол кадрда толық көрінуі үшін қырынан отырыңыз...",
        "cam_rec": "Жазылуда... Жаттығуды асықпай орындаңыз.",
        "analyzing": "Бейне тексерілуде...",
        "pose_fail": "Қол анық көрінбеді немесе жазба тым қысқа. Жарық жақсы жерде камераны қырынан қойып, қайта көріңіз.",
        "verdict_ok": "Орындалды",
        "verdict_check": "Бейненұсқаулықты қайта қарап шығыңыз",
        "cam_done": "Камера жазбасы аяқталды (демо-трекер)",
        "cam_done_hint": "Автоматты модель бағасын алу үшін «Бейнежазбаны жүктеу» режимін қолданыңыз.",
        "approx_note": "Бағалау шамамен берілген, дәрігерді алмастырмайды. Жағдайыңыз нашарласа 103-ке қоңырау шалыңыз.",
        "cycles_found": "Анықталған цикл саны",
        "details_exp": "Толығырақ / Мамандарға (график, циклдер және баға)",
        "prob_lbl": "Толық орындалу бағасы",
        "det_lbl": "Қол көрінген кадрлар",
        "hand_used": "Таңдалған қол",
        "plot_title": "Уақыт бойынша білек қозғалысы (> 0.6 с үзілістер жасырылған)",
        "plot_y": "Еңкею (град.)",
        "plot_x": "Уақыт (сек)",
        "summary_hdr": "Жаттығудың жергілікті қорытындысы (бейнелер сақталмайды)",
        "sum_cycles": "Анықталған цикл",
        "sum_ok": "Орындалды (цикл)",
        "sum_check": "Нұсқаулықты қарау (цикл)",
        "sum_sessions": "Тексерілген бейне",
        "btn_clear": "Қорытындыны тазалау",
        "hist_time": "Уақыты",
        "hist_cycles": "Цикл",
        "hist_ok": "Орындалды",
        "hist_check": "Нұсқаулық",
        "hist_res": "Бейне нәтижесі",
        "col_cycle": "Цикл",
        "col_time": "Уақыт (с)",
        "col_range": "Ауқымы (°)",
        "col_min": "Мин. (°)",
        "col_prob": "Баға (%)",
        "col_status": "Цикл класы",
        "limitations_hdr": "Шынайы қорытындылар мен шектеулер",
    },
}

if "last_attempted" not in st.session_state:
    st.session_state["last_attempted"] = False
if "last_result" not in st.session_state:
    st.session_state["last_result"] = None


def mask_gaps(t_u, th_s, t_real, max_gap=0.6):
    t_real = np.asarray(t_real, dtype=float)
    if len(t_real) == 0:
        return np.array(th_s, dtype=float)
    i = np.searchsorted(t_real, t_u)
    left = t_real[np.clip(i - 1, 0, len(t_real) - 1)]
    right = t_real[np.clip(i, 0, len(t_real) - 1)]
    dist = np.minimum(np.abs(t_u - left), np.abs(t_u - right))
    out = np.array(th_s, dtype=float)
    out[dist > max_gap] = np.nan
    return out


@st.cache_resource
def load_artifact():
    with open(MODEL_PKL, "rb") as f:
        return pickle.load(f)


@st.cache_resource
def load_pose_bytes():
    return POSE_TASK.read_bytes()


def load_history():
    if HISTORY_PATH.exists():
        try:
            return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def save_history(hist):
    HISTORY_PATH.write_text(json.dumps(hist, ensure_ascii=False, indent=2), encoding="utf-8")


def record_history(res):
    if res is None or not res.get("is_scored") or not res.get("app_pose_ok"):
        return
    hist = load_history()
    hist.append({
        "time": datetime.datetime.now().strftime("%H:%M:%S"),
        "hand": res["chosen_hand"],
        "n_cycles": len(res["cycles"]),
        "n_ok_cycles": sum(1 for c in res["cycles"] if c["verdict"] == "complete"),
        "n_chk_cycles": sum(1 for c in res["cycles"] if c["verdict"] != "complete"),
        "verdict": res["video_verdict"],
    })
    save_history(hist)


def classify_from_landmarks(t, lm_px, hw, hand_mode: str, artifact, is_scored: bool = True):
    out = analyze_landmarks(t, lm_px, hw, hand_mode=hand_mode)
    if out is None or not out["cycles"]:
        return None
    if "t_real" not in out or "chosen_hand" not in out:
        raise KeyError("analyze_landmarks must return 't_real' and 'chosen_hand'")

    dur_total = float(out["t_u"][-1] - out["t_u"][0]) if len(out["t_u"]) >= 2 else 0.0
    det_pct = float(out["det_pct"])
    app_pose_ok = (det_pct >= 50.0) and (dur_total >= 3.0)

    model = artifact["model"]
    conf_thr = float(artifact["conf_thr"])
    feat_cols = artifact["feat_cols"]

    cycle_results = []
    probs = []
    for c in out["cycles"]:
        X = pd.DataFrame([[c["features"][col] for col in feat_cols]], columns=feat_cols)
        prob_complete = float(model.predict_proba(X)[0, 1])
        conf = max(prob_complete, 1.0 - prob_complete)
        accepted = app_pose_ok and (conf >= conf_thr)
        verdict = "complete" if (accepted and prob_complete >= 0.5) else "check"
        probs.append(prob_complete)
        cycle_results.append({
            "cycle_id": c["cycle_id"],
            "t_start": round(c["t_start"], 1),
            "t_end": round(c["t_end"], 1),
            "th_rng": round(c["features"]["th_rng"], 1),
            "th_min": round(c["features"]["th_min"], 1),
            "prob_complete": prob_complete,
            "conf": conf,
            "verdict": verdict,
        })

    mean_prob = float(np.mean(probs))
    video_conf = max(mean_prob, 1.0 - mean_prob)
    video_accepted = app_pose_ok and (video_conf >= conf_thr)
    video_verdict = "complete" if (video_accepted and mean_prob >= 0.5) else "check"

    return {
        "is_scored": is_scored,
        "chosen_hand": out["chosen_hand"],
        "det_pct": det_pct,
        "dur_total": dur_total,
        "app_pose_ok": app_pose_ok,
        "t_u": out["t_u"],
        "th_s": out["th_s"],
        "t_real": out["t_real"],
        "cycles": cycle_results,
        "video_prob": mean_prob,
        "video_conf": video_conf,
        "video_verdict": video_verdict,
    }


def classify_video(video_path: str, hand_mode: str, artifact, progress_bar):
    t, lm_px, hw, _ = extract_landmarks_from_video(
        video_path,
        model_path=str(POSE_TASK),
        step=2,
        progress_cb=lambda p: progress_bar.progress(float(p)),
    )
    return classify_from_landmarks(t, lm_px, hw, hand_mode, artifact, is_scored=True)


def run_live_camera_demo(rec_sec: int, hand_mode: str, artifact, preview_box, status_box, prep_txt, rec_txt):
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        return None, False
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    model_bytes = load_pose_bytes()
    opts = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_buffer=model_bytes),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.2,
        min_pose_presence_confidence=0.2,
        min_tracking_confidence=0.2,
    )

    t_list, px_list = [], []
    hw_cam = (480, 640)
    trail = deque(maxlen=25)

    try:
        # 1) Обратный отсчёт 3 - 2 - 1
        status_box.info(prep_txt)
        t_prep = time.perf_counter()
        while True:
            el_p = time.perf_counter() - t_prep
            if el_p >= 3.0:
                break
            ok, fr = cap.read()
            if not ok:
                break
            disp = cv2.flip(fr, 1)
            cnt = 3 - int(el_p)
            cv2.putText(disp, f"START IN {cnt}...", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (192, 101, 21), 4)
            preview_box.image(cv2.cvtColor(disp, cv2.COLOR_BGR2RGB), width="stretch")

        # 2) Живая запись с трекингом
        status_box.info(rec_txt)
        k, last_ts = 0, -1
        t0 = time.perf_counter()
        with vision.PoseLandmarker.create_from_options(opts) as det:
            while True:
                elapsed = time.perf_counter() - t0
                if elapsed >= rec_sec:
                    break
                ok, fr = cap.read()
                if not ok:
                    break
                k += 1
                if k % 2 == 0:
                    continue

                h0, w0 = fr.shape[:2]
                if w0 > 640:
                    fr_work = cv2.resize(fr, (640, max(1, int(h0 * 640.0 / w0))))
                else:
                    fr_work = fr
                h, w = fr_work.shape[:2]
                hw_cam = (h, w)

                ts = max(last_ts + 1, int(elapsed * 1000.0))
                last_ts = ts
                res = det.detect_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr_work, cv2.COLOR_BGR2RGB)), ts
                )
                t_list.append(elapsed)

                draw_fr = fr_work.copy()
                overlay_txt = f"Show arm from side | {rec_sec - elapsed:.1f}s"
                overlay_col = (130, 110, 90)

                if res.pose_landmarks:
                    lm = res.pose_landmarks[0]
                    px_arr = np.array([[lm[j].x * w, lm[j].y * h, lm[j].visibility] for j in IDX], dtype=np.float32)
                    px_list.append(px_arr)

                    if hand_mode in ("L", "R"):
                        s_show = hand_mode
                    else:
                        vL = min(px_arr[2, 2], px_arr[4, 2])
                        vR = min(px_arr[3, 2], px_arr[5, 2])
                        s_show = "L" if vL >= vR else "R"

                    for s, (si, ei, wi, ii) in (("L", (0, 2, 4, 6)), ("R", (1, 3, 5, 7))):
                        pts = [(int(px_arr[p, 0]), int(px_arr[p, 1])) for p in (si, ei, wi, ii)]
                        is_main = (s == s_show)
                        col = (192, 101, 21) if is_main else (210, 180, 150)
                        thk = 4 if is_main else 1
                        cv2.line(draw_fr, pts[0], pts[1], col, thk)
                        cv2.line(draw_fr, pts[1], pts[2], col, thk)
                        cv2.line(draw_fr, pts[2], pts[3], col, thk)
                        if is_main:
                            for pt in pts[:3]:
                                cv2.circle(draw_fr, pt, 5, (255, 200, 90), -1)
                            trail.append(pts[2])
                            vx = px_arr[wi, 0] - px_arr[ei, 0]
                            vy = px_arr[wi, 1] - px_arr[ei, 1]
                            theta_now = float(np.degrees(np.arctan2(-vy, abs(vx) + 1e-6)))
                            overlay_txt = f"Tracking OK | {theta_now:.0f} deg | {rec_sec - elapsed:.1f}s"
                            overlay_col = (192, 101, 21)

                    for idx_t in range(1, len(trail)):
                        cv2.line(draw_fr, trail[idx_t - 1], trail[idx_t], (227, 180, 143), 2)
                else:
                    px_list.append(np.full((len(IDX), 3), np.nan, dtype=np.float32))

                disp = cv2.flip(draw_fr, 1)
                cv2.putText(disp, overlay_txt, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, overlay_col, 2)
                preview_box.image(cv2.cvtColor(disp, cv2.COLOR_BGR2RGB), width="stretch")
    finally:
        cap.release()
        preview_box.empty()
        status_box.empty()

    if len(t_list) < 8:
        return None, True
    t_arr = np.array(t_list, dtype=np.float32)
    lm_px = np.stack(px_list, axis=0)
    return classify_from_landmarks(t_arr, lm_px, hw_cam, hand_mode, artifact, is_scored=True), True


def ci_overlap(ci_a, ci_b):
    if not (isinstance(ci_a, (list, tuple)) and isinstance(ci_b, (list, tuple)) and len(ci_a) == 2 and len(ci_b) == 2):
        return None
    return (ci_a[0] <= ci_b[1]) and (ci_b[0] <= ci_a[1])


def build_dynamic_limitations(artifact, lang: str):
    m = artifact["metrics"]
    m_name = artifact.get("model_name", "Model")
    ct = int(round(float(artifact["conf_thr"]) * 100))

    lovo = m.get("lovo_auto_video_no_dur", {})
    test = m.get("official_test_08", {})
    m_lovo = lovo.get(m_name, {})
    b_lovo = lovo.get("Baseline", {})
    m_test = test.get(m_name, {})
    b_test = test.get("Baseline", {})

    lr_lovo_ba = m_lovo.get("BA", "—")
    bs_lovo_ba = b_lovo.get("BA", "—")
    lr_test_ba = m_test.get("BA", "—")
    bs_test_ba = b_test.get("BA", "—")
    lr_cm = m_test.get("CM", "—")
    acc_pct = m_test.get("accepted_pct")
    acc_ba = m_test.get("accepted_BA")

    ov_lovo = ci_overlap(m_lovo.get("CI95"), b_lovo.get("CI95"))
    ov_test = ci_overlap(m_test.get("CI95"), b_test.get("CI95"))

    if isinstance(lr_lovo_ba, (int, float)) and isinstance(bs_lovo_ba, (int, float)):
        cmp_ru = "выше" if lr_lovo_ba > bs_lovo_ba else ("ниже" if lr_lovo_ba < bs_lovo_ba else "равна")
        cmp_kz = "жоғары" if lr_lovo_ba > bs_lovo_ba else ("төмен" if lr_lovo_ba < bs_lovo_ba else "тең")
    else:
        cmp_ru, cmp_kz = "сравнена с", "салыстырылды"

    if ov_lovo is True or ov_test is True:
        ci_ru = "доверительные интервалы пересекаются — разница в пределах статистической погрешности."
        ci_kz = "сенімділік аралықтары қиылысады — айырмашылық статистикалық қателік шегінде."
    else:
        ci_ru = "сравнение следует оценивать с учётом размера выборки."
        ci_kz = "салыстыруды іріктеме көлемін ескере отырып бағалау керек."

    acc_ru = f" (на Test 08 принято {acc_pct}% видео, BA на принятых = {acc_ba}, выборка мала)" if acc_pct is not None else ""
    acc_kz = f" (Test 08: {acc_pct}% бейне қабылданды, қабылданғандарда BA = {acc_ba})" if acc_pct is not None else ""

    if lang == "ru":
        return [
            f"Модель ({m_name}) по точечной оценке {cmp_ru} baseline (LOVO: {lr_lovo_ba} против {bs_lovo_ba}; Test 08: {lr_test_ba} против {bs_test_ba}), однако {ci_ru}",
            f"На Test 08 матрица ошибок {lr_cm} показывает ложноположительный риск (5 из 10 неполных видео получили «Выполнено»; macro-F1 = 0.733). Применён порог уверенности ≥ {ct}%{acc_ru}.",
            "В приложении порог видимости руки повышен до ≥ 50% кадров (и длительность ≥ 3 с). Принудительные режимы «Левая/Правая рука» отдельно не валидировались.",
            "Система оценивает наклон предплечья к горизонтали по 2D-точкам локтя и запястья (MediaPipe PoseLandmarker FULL), а не 3D-угол локтя, так как в обучающих записях (01–05) плечо не в кадре. Пропуски > 0.6 с на графике скрыты.",
            "Режим камеры компьютера используется как демонстрационный трекер движения: модель обучалась на медленном темпе реабилитации из датасета (1 повтор за 10–15 с), поэтому автоматическая оценка выводится только для видеозаписей.",
            "Разметка циклов унаследована от метки всего видео (слабая разметка). Сервис не является медицинским изделием и не заменяет врача.",
        ]
    return [
        f"Модель ({m_name}) нүктелік баға бойынша baseline-нан {cmp_kz} (LOVO: {lr_lovo_ba} қарсы {bs_lovo_ba}; Test 08: {lr_test_ba} қарсы {bs_test_ba}), алайда {ci_kz}",
        f"Test 08 матрицасы {lr_cm} жалған оң қате қаупін көрсетеді (macro-F1 = 0.733). Сондықтан сенімділік шегі ≥ {ct}% қолданылды{acc_kz}.",
        "Қолданбада қолдың көріну шегі ≥ 50% кадр (және ≥ 3 с) етіп күшейтілген. «Сол/Оң қол» режимдері бөлек валидацияланбаған.",
        "Жүйе 3D-бұрышты емес, білектің көлденеңге еңкеюін 2D-нүктелер бойынша бағалайды. Графикте > 0.6 с үзілістер жасырылған.",
        "Компьютер камерасы демонстрациялық трекер ретінде қолданылады: модель датасеттегі баяу қарқынға оқытылған, сондықтан автоматты бағалау тек бейнежазбаларға беріледі.",
        "Цикл белгісі бүкіл бейнеден алынған (әлсіз белгілеу). Шешім медициналық құрал болып табылмайды.",
    ]


# ---------------- UI HEADER ----------------
col_h1, col_h2 = st.columns([4, 1.3])
with col_h2:
    lang_choice = st.radio("Язык / Тіл", ["Қазақша", "Русский"], index=1, horizontal=True)
lang = "kz" if lang_choice == "Қазақша" else "ru"
T = TEXTS[lang]

with col_h1:
    st.title(T["title"])
    st.caption(T["subtitle"])

if not MODEL_PKL.exists() or not POSE_TASK.exists():
    st.error(T["missing_files"])
    st.stop()

st.markdown(f"<div class='safety-box'>{T['safety']}</div>", unsafe_allow_html=True)
st.write("")

ex_choice = st.selectbox(
    "Упражнение / Жаттығу",
    options=["E02", "E01", "E03", "E04"],
    index=0,
    format_func=lambda k: EXERCISES[k][lang],
)

artifact = load_artifact()
tab1, tab2 = st.tabs([T["tab_train"], T["tab_report"]])

with tab1:
    if not EXERCISES[ex_choice]["active"]:
        if lang == "ru":
            st.info(
                f"Модуль **{ex_choice}** запланирован в архитектуре масштабирования SerIQ. "
                "Текущий прототип сфокусирован на честной валидации упражнения **E02** (по ТЗ). "
                "Для **E03–E04** осознанно не применяется `PoseLandmarker` без точек пальцев — туда на следующем этапе подключается `HandLandmarker` (21 точка кисти)."
            )
        else:
            st.info(
                f"**{ex_choice}** модулі SerIQ кеңейту архитектурасында жоспарланған. "
                "Қазіргі прототип ТТ талабына сай **E02** жаттығуын шынайы тексеруге бағытталған. "
                "**E03–E04** үшін саусақ нүктелерінсіз `PoseLandmarker` қолданылмайды — келесі кезеңде `HandLandmarker` (21 нүкте) қосылады."
            )
    else:
        c_left, c_right = st.columns([1, 1.25], gap="large")

        with c_left:
            with st.container(border=True):
                st.subheader(T["step1"])
                st.info(T["instr_note"])
                custom_instr = pathlib.Path("instruction_e02.mp4")
                if custom_instr.exists():
                    st.video(str(custom_instr))
                else:
                    st.warning(T["instr_none"])

        with c_right:
            with st.container(border=True):
                st.subheader(T["step2"])
                input_mode = st.radio(
                    "Mode",
                    label_visibility="collapsed",
                    options=["upload", "cam"],
                    format_func=lambda k: T["mode_opts"][k],
                    horizontal=True,
                )
                with st.expander(T["hand_adv"]):
                    hand_key = st.radio(
                        "Hand",
                        label_visibility="collapsed",
                        options=["auto_video", "L", "R"],
                        index=0,
                        format_func=lambda k: T["hand_opts"][k],
                        horizontal=True,
                    )

                if input_mode == "upload":
                    up = st.file_uploader(T["upload_lbl"], type=["mp4", "mov", "avi", "mkv"])
                    if up is not None and st.button(T["btn_analyze"], type="primary", width="stretch"):
                        st.session_state["last_attempted"] = False
                        st.session_state["last_result"] = None
                        suffix = pathlib.Path(up.name).suffix or ".mp4"
                        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                            tmp.write(up.read())
                            tmp_path = tmp.name
                        pb = st.progress(0.0, text=T["analyzing"])
                        try:
                            res_new = classify_video(tmp_path, hand_key, artifact, pb)
                        except Exception:
                            traceback.print_exc()
                            res_new = None
                        finally:
                            pb.empty()
                            if os.path.exists(tmp_path):
                                os.remove(tmp_path)
                        st.session_state["last_attempted"] = True
                        st.session_state["last_result"] = res_new
                        record_history(res_new)
                else:
                    st.caption(T["cam_note"])
                    rec_sec = st.slider(T["cam_sec"], min_value=5, max_value=15, value=10, step=1)
                    if st.button(T["btn_cam_start"], type="primary", width="stretch"):
                        st.session_state["last_attempted"] = False
                        st.session_state["last_result"] = None
                        preview_box = st.empty()
                        status_box = st.empty()
                        try:
                            res_new, cam_ok = run_live_camera_demo(
                                rec_sec, hand_key, artifact, preview_box, status_box, T["cam_prep"], T["cam_rec"]
                            )
                        except Exception:
                            traceback.print_exc()
                            res_new, cam_ok = None, True
                        if not cam_ok:
                            st.error(T["cam_err"])
                        else:
                            st.session_state["last_attempted"] = True
                            st.session_state["last_result"] = res_new
                            record_history(res_new)

            res = st.session_state["last_result"]
            if st.session_state["last_attempted"]:
                if res is None or not res["app_pose_ok"]:
                    st.markdown(f"<div class='verdict-check'>↻ {T['verdict_check']}</div>", unsafe_allow_html=True)
                    st.warning(T["pose_fail"])
                    st.caption(T["approx_note"])
                elif not res["is_scored"]:
                    st.markdown(
                        f"<div class='verdict-ok'>✓ {T['cam_done']} · {T['cycles_found']}: {len(res['cycles'])}</div>",
                        unsafe_allow_html=True,
                    )
                    st.info(T["cam_done_hint"])
                    y_plot = mask_gaps(res["t_u"], res["th_s"], res["t_real"], max_gap=0.6)
                    fig, ax = plt.subplots(figsize=(7, 2.8))
                    fig.patch.set_facecolor("#F5F9FF")
                    ax.set_facecolor("#FFFFFF")
                    ax.plot(res["t_u"], y_plot, color="#1565C0", lw=2.3)
                    for c in res["cycles"][1:]:
                        ax.axvline(c["t_start"], color="#9DB7D5", linestyle="--", alpha=0.8)
                    ax.set_title(T["plot_title"], fontsize=10.5, color="#0D2B4D")
                    ax.set_xlabel(T["plot_x"])
                    ax.set_ylabel(T["plot_y"])
                    valid_y = y_plot[~np.isnan(y_plot)]
                    if len(valid_y) > 0:
                        ax.set_ylim(float(np.min(valid_y)) - 10.0, float(np.max(valid_y)) + 10.0)
                    ax.grid(True, alpha=0.25)
                    plt.tight_layout()
                    st.pyplot(fig)
                    plt.close(fig)
                else:
                    if res["video_verdict"] == "complete":
                        st.markdown(f"<div class='verdict-ok'>✓ {T['verdict_ok']}</div>", unsafe_allow_html=True)
                    else:
                        st.markdown(f"<div class='verdict-check'>↻ {T['verdict_check']}</div>", unsafe_allow_html=True)
                    st.caption(T["approx_note"])

                    with st.expander(f"{T['details_exp']} · {T['cycles_found']}: {len(res['cycles'])}"):
                        m1, m2, m3 = st.columns(3)
                        m1.metric(T["prob_lbl"], f"{res['video_prob']*100:.0f}%")
                        m2.metric(T["det_lbl"], f"{res['det_pct']:.0f}%")
                        m3.metric(T["hand_used"], T["hand_opts"].get(res["chosen_hand"], res["chosen_hand"]))

                        y_plot = mask_gaps(res["t_u"], res["th_s"], res["t_real"], max_gap=0.6)
                        fig, ax = plt.subplots(figsize=(7, 2.8))
                        fig.patch.set_facecolor("#F5F9FF")
                        ax.set_facecolor("#FFFFFF")
                        ax.plot(res["t_u"], y_plot, color="#1565C0", lw=2.3)
                        for c in res["cycles"][1:]:
                            ax.axvline(c["t_start"], color="#9DB7D5", linestyle="--", alpha=0.8)
                        ax.set_title(T["plot_title"], fontsize=10.5, color="#0D2B4D")
                        ax.set_xlabel(T["plot_x"])
                        ax.set_ylabel(T["plot_y"])
                        valid_y = y_plot[~np.isnan(y_plot)]
                        if len(valid_y) > 0:
                            ax.set_ylim(float(np.min(valid_y)) - 10.0, float(np.max(valid_y)) + 10.0)
                        ax.grid(True, alpha=0.25)
                        plt.tight_layout()
                        st.pyplot(fig)
                        plt.close(fig)

                        rows_t = []
                        for c in res["cycles"]:
                            rows_t.append({
                                T["col_cycle"]: c["cycle_id"],
                                T["col_time"]: f"{c['t_start']}–{c['t_end']}",
                                T["col_range"]: c["th_rng"],
                                T["col_min"]: c["th_min"],
                                T["col_prob"]: f"{c['prob_complete']*100:.0f}%",
                                T["col_status"]: T["verdict_ok"] if c["verdict"] == "complete" else T["verdict_check"],
                            })
                        st.dataframe(pd.DataFrame(rows_t), width="stretch", hide_index=True)

        st.divider()
        st.subheader(T["summary_hdr"])
        hist = load_history()
        n_att = len(hist)
        n_cyc = sum(int(h.get("n_cycles", 1)) for h in hist)
        n_ok_cyc = sum(int(h.get("n_ok_cycles", 1 if h.get("verdict") == "complete" else 0)) for h in hist)
        n_chk_cyc = max(0, n_cyc - n_ok_cyc)

        s1, s2, s3, s4 = st.columns(4)
        s1.metric(T["sum_cycles"], str(n_cyc))
        s2.metric(T["sum_ok"], str(n_ok_cyc))
        s3.metric(T["sum_check"], str(n_chk_cyc))
        s4.metric(T["sum_sessions"], str(n_att))

        if hist:
            sc1, sc2 = st.columns([1, 1.5])
            with sc1:
                fig_s, ax_s = plt.subplots(figsize=(4.2, 2.5))
                fig_s.patch.set_facecolor("#F5F9FF")
                ax_s.set_facecolor("#FFFFFF")
                ax_s.bar([T["verdict_ok"], T["sum_check"]], [n_ok_cyc, n_chk_cyc], color=["#1565C0", "#8FB4E3"])
                ax_s.set_ylabel(T["sum_cycles"])
                ax_s.grid(axis="y", alpha=0.25)
                plt.tight_layout()
                st.pyplot(fig_s)
                plt.close(fig_s)
            with sc2:
                hist_rows = []
                for h_item in reversed(hist[-10:]):
                    hist_rows.append({
                        T["hist_time"]: h_item.get("time", ""),
                        T["hist_cycles"]: h_item.get("n_cycles", 1),
                        T["hist_ok"]: h_item.get("n_ok_cycles", 0),
                        T["hist_check"]: h_item.get("n_chk_cycles", 0),
                        T["hist_res"]: T["verdict_ok"] if h_item.get("verdict") == "complete" else T["verdict_check"],
                    })
                st.dataframe(pd.DataFrame(hist_rows), width="stretch", hide_index=True)

            if st.button(T["btn_clear"]):
                save_history([])
                st.rerun()

with tab2:
    st.subheader(T["tab_report"])
    m = artifact["metrics"]

    def metrics_to_df(block):
        if not isinstance(block, dict):
            return pd.DataFrame()
        out_r = []
        for model_k, vals in block.items():
            if not isinstance(vals, dict):
                continue
            row = {
                "Model": model_k,
                "BA": vals.get("BA", "—"),
                "95% CI": str(vals.get("CI95", "—")),
                "F1 (Complete)": vals.get("F1", "—"),
                "CM": str(vals.get("CM", "—")),
            }
            if vals.get("accepted_pct") is not None:
                row["Accepted %"] = vals.get("accepted_pct", "—")
                row["BA (accepted)"] = vals.get("accepted_BA", "—")
            out_r.append(row)
        return pd.DataFrame(out_r)

    col_m1, col_m2 = st.columns(2)
    with col_m1:
        if "lovo_auto_video_no_dur" in m:
            st.markdown("**LOVO 01–05 | auto_video | NO dur**")
            st.dataframe(metrics_to_df(m["lovo_auto_video_no_dur"]), width="stretch", hide_index=True)
        if "supplementary_lovo_6vol" in m:
            st.markdown("**Supplementary LOVO (01–05 + 08)**")
            st.dataframe(metrics_to_df(m["supplementary_lovo_6vol"]), width="stretch", hide_index=True)
    with col_m2:
        if "official_test_08" in m:
            st.markdown("**Official Test: Доброволец 08 (открыт 1 раз)**")
            st.dataframe(metrics_to_df(m["official_test_08"]), width="stretch", hide_index=True)
        if "lovo_auto_video_with_dur" in m or "lovo_auto_frame_no_dur" in m:
            st.markdown("**Ablation LOVO 01–05: WITH dur & auto_frame**")
            if "lovo_auto_video_with_dur" in m:
                st.dataframe(metrics_to_df(m["lovo_auto_video_with_dur"]), width="stretch", hide_index=True)
            if "lovo_auto_frame_no_dur" in m:
                st.dataframe(metrics_to_df(m["lovo_auto_frame_no_dur"]), width="stretch", hide_index=True)

    c_img1, c_img2 = st.columns(2)
    with c_img1:
        if pathlib.Path("fig_confusion_matrices.png").exists():
            st.image("fig_confusion_matrices.png", width="stretch")
    with c_img2:
        if pathlib.Path("fig_confidence_coverage.png").exists():
            st.image("fig_confidence_coverage.png", width="stretch")

    st.subheader(T["limitations_hdr"])
    for item in build_dynamic_limitations(artifact, lang):
        st.markdown(f"- {item}")