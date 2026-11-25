# SerIQ PWA

Mobile web client intended for Vercel. The legacy Streamlit app remains at the repository root; this folder is the phone-first application.

## Run locally

```powershell
cd web
npm install
npm run dev -- --host 0.0.0.0
```

Camera access requires HTTPS or `localhost`. On a physical iPhone, use the HTTPS preview deployment. Camera sessions can be set from 1 to 10 minutes in one-minute steps; the locally captured clip and live landmark samples are analyzed on-device and the clip is discarded when leaving the result screen. Uploaded video files are also processed in the browser and are not uploaded.

## Train and export browser models

From the repository root, with the Python dependencies in `requirements.txt` installed:

```powershell
python train_mobile_models.py
```

The script uses labels from each `Complete`/`Incomplete` directory, performs leave-one-volunteer-out validation within each exercise's `Train` folder, then evaluates the held-out `Test` folder once. It writes the classifier JSON files to `public/models/` and a metrics summary to that folder. The source videos and extracted landmark cache stay local and are not included in the web build.

E02 is exported from the existing fitted Logistic Regression pipeline. E01/E03/E04 use Hand Landmarker features in this first iteration. The wrist and hand features are engineering hypotheses that must be judged against their held-out results and real phone recordings before treating those exercises as validated.

## Supabase accounts and history

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor.
2. Enable anonymous sign-in under Authentication providers. Enable Email; configure Google OAuth if using Google login.
3. Set Authentication Site URL and Redirect URLs for localhost and the Vercel deployment.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to local `.env.local` and Vercel. Never expose a secret/service-role key in the browser.
5. Users can exercise without an account, then sign in by email/password or Google. The app can upgrade an anonymous session to preserve its account ID. Online history is still opt-in. Only exercise ID, timestamp, verdict, probability, confidence, detection percentage, duration and cycle count are stored; user video is not uploaded.

## Doctor chat (requires assigned accounts)

Run [`supabase/care-chat.sql`](supabase/care-chat.sql) after configuring Auth. New accounts receive a patient profile. Doctor roles and patient-doctor relationships are assigned administratively; users cannot grant themselves a doctor role. RLS limits thread and message access to the assigned participants. See [`supabase/AUTH_CHAT_SETUP.md`](supabase/AUTH_CHAT_SETUP.md) for Google setup and test-account assignment.

The patient app and doctor view support text messages for assigned conversations. No clinician is supplied with this code, and an account has no chat until a doctor is explicitly assigned. The prototype displays a privacy/safety note; use only synthetic accounts and text for the solveathon. It is not ready to store real patient records.

## Deploy to Vercel

Import the repository as a Vercel project and set **Root Directory** to `web`. The Vercel settings in [`vercel.json`](vercel.json) build Vite into `dist`. Set the Supabase public URL and anon key, then set the Vercel domain in Supabase Auth redirect URLs. Vercel's HTTPS deployment allows Safari to request camera permission.

On iPhone 11, open the HTTPS URL in Safari, tap Share, then **Add to Home Screen**. Camera access must be granted on the first camera session. Upload mode opens the iOS video picker.

## Assets and limitations

- All four classifier JSON files together are about 3.4 KB. MediaPipe's shared Hand/Pose Landmarker task models and WebAssembly runtime are separate: each exercise downloads Pose and Hand on first use to draw the shoulder, elbow, wrist and finger landmarks. Vercel stores about 47.7 MB of model/runtime assets, including both WASM variants; dataset videos are excluded.
- MediaPipe's WASM assets are included under `public/wasm/`; the service worker does not cache WASM or model files, so inference needs a network connection.
- Instruction screens show an animated 3D mannequin for each exercise, with a pause control and localized written steps. E02 also includes the team-supplied `video2.mp4` with a video/3D switch. It is bundled for Vercel; optional Supabase Storage setup is documented in `supabase/INSTRUCTION_VIDEO_SETUP.md`. The clip has not been clinically reviewed.
- Real iPhone 11 camera, uploaded MOV/MP4 decoding, battery use and model accuracy must be reviewed on-device before public use.
- See [`MODEL_EVALUATION_RU.md`](MODEL_EVALUATION_RU.md) for current held-out results and limitations. E03 and E04 currently perform poorly on their separate test volunteer and must be treated as demo-only results.
