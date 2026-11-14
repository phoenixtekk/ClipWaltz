# ClipWaltz — Help Center

End-user documentation. Categories mirror the product's features (kept in sync with
[`FEATURES.md`](FEATURES.md)). This is a stub scaffold — articles are written as each feature
ships. It will also surface in-app at `/help`.

## Getting started
- **Four tools, one studio:** **AutoWaltz** turns your own photos and videos into a beat-synced music
  video. **Waltz AI** creates brand-new video clips from a description or a photo. **Waltz Avatar** gives you a
  presenter who reads your script. **WaltzDeck** plans ads, slideshows, presentations and explainers scene by scene.
  The home page (www.clipwaltz.com) shows each one under **Four tools, one studio**, plus the latest videos people
  shared to the community.
- **New project:** give it a name (and a description if you like), then choose **AutoWaltz** (music video from my media)
  (pick an occasion and upload your clips) or **Waltz AI** (AI video from a template) (Product Promo, Social Reel, Story,
  Event Recap, Travel or Cinematic Intro — the **Waltz AI** tab opens with the template's settings ready).
- What ClipWaltz does: drop in your phone photos & videos, get a polished music video back.
- Creating an account · signing in.
- **Your dashboard** is the first thing you see after signing in: your stats (projects, videos
  made, minutes, likes, comments), how many renders you've used this month vs your plan, a
  **Jump back in** section (two rows of your most recent projects), and a **community feed** on the right — tap any of it
  to explore what others are making.
- **Deleting a project** removes it for good: its uploaded clips, finished videos, Waltz AI clips and
  exports are all deleted too (it can't be undone — download anything you want to keep first). A photo or
  video you also use in another project stays in that project.

## Choosing the AI that writes for you (AI models)
- Open the **account menu → AI models**. Pick **Built-in (ClipWaltz AI)** — included in every plan, and your media never
  leaves ClipWaltz — or, when they're offered on your plan, **Claude**, **ChatGPT**, **DeepSeek** or **Gemini**.
- **"Included with your plan"** uses ClipWaltz's account with that company. **"With your own key"** uses your account:
  paste an API key from that company's developer site under **Your own API keys** → **Test & save**. ClipWaltz tests the
  key first, stores it encrypted, and only ever shows its last 4 characters. That company bills you for what's used.
- Your choice writes your WaltzDeck plans, scripts and voice lines, Edit with AI, scene rewrites, translations, campaign
  hooks and imports, and describes your photos and clips. With an outside model, that text and still frames from your
  photos and clips are sent to that company.
- **Included with your plan** has a daily limit (shown on the option). After it, the built-in model writes for you until
  the next day (UTC). Your own key has no ClipWaltz limit.
- **Your own computer (free):** if it's offered on your plan, ClipWaltz can use the AI models on your own computer
  through **Ollama**. Install Ollama and a model (for example `ollama pull qwen3:8b`) and Node.js 18 or newer, download
  the **ClipWaltz Connector** from **AI models → Your computers**, run `node clipwaltz-connector.mjs pair`, open the page
  it shows, **type the code from your screen**, check that the computer shown is yours, and click **Approve this
  computer**. Never approve a code someone else sent you — that would connect their computer to your account. Then keep it running with
  `node clipwaltz-connector.mjs` and pick **Your computer** above. Your text and photo frames go only to your computer.
  If the computer is off or busy, the built-in model writes for you. **Disconnect** removes a computer at once.
- **If it fails** (wrong key, no credit left, the service is down), your video is still made with the built-in model, and
  the AI models page shows what went wrong. Use **Test** to check your key again, or **Delete** to remove it.

## Cloud video models in Waltz AI
- In **Waltz AI → Model**, pick **ClipWaltz AI** (our own model) or a cloud model offered on your plan — **Kling**,
  **Runway** or **MiniMax**. Each shows what a second costs in AI credits, or **your key** if you added your own key for
  that company under **account menu → AI models → Video models** (then ClipWaltz charges no credits; that company bills you).
- Some models only make certain lengths or shapes — the ones they can't make are greyed out. Runway Gen-4 Turbo only works
  from a photo.
- Cloud clips usually take a few minutes. If the company can't make the clip (for example its content rules block it), the
  clip fails, your credits come back, and **Retry** lets you try again. **Cancel** stops it.
- There's a daily limit on clips made with ClipWaltz's account; your own key has no ClipWaltz limit.
- A clip made with ClipWaltz's account can be cancelled only until it's sent to the video company; after that it finishes
  and its credits are used. Clips made with your own key can be cancelled any time.

## Talking photo — make a photo speak
1. Open **Waltz AI** in the editor and choose **Talking photo**.
2. **Pick a photo** from your project. Clear, front-facing portraits work best — one face, eyes and mouth visible.
3. Choose **what it says**:
   - **Type a script** (up to 600 characters, about 30 seconds) and pick a **voice** — press **Hear** to listen first.
     Write the script in the voice's language (English, Spanish, French, Italian or Portuguese). **Pace** makes it a
     little slower or faster.
   - or **Upload a recording** (MP3, M4A, WAV, OGG, FLAC; up to 20 MB). Only the first 30 seconds are used.
4. Pick the **shape** — as the photo, 9:16, 1:1 or 16:9.
5. Tick **"This is me, or I have this person's permission to make them speak."** Only use your own face or someone who
   agreed — never a public figure.
6. Press **Make it talk**. It takes a while — roughly 45–50 seconds of rendering for every second of speech, plus any
   queue — and the clip appears under **Generated versions**. **Cancel** stops it and gives your credits back.

**Quality:** **Standard** (1 AI credit per second) sharpens the video; **High** (2 AI credits per second) uses an AI
restore for more natural skin and eyes and takes about twice as long.

**Cost:** 1 or 2 AI credits per second of speech (Standard / High), up to 30 seconds. For a script we reserve an estimate and then charge only the
seconds actually made. **Every talking photo carries an "AI-generated" label** in the top-right corner, also in downloads.

## Waltz Avatar — your own presenter
Record yourself once, and your WaltzDeck videos can be presented **by you** — your face, speaking each scene's voice line.

**Create your presenter** (top menu → **Avatars**):
1. Type a name (usually yours) and press **Create presenter**.
2. **A video of you talking:** record 10 seconds to 2 minutes with your camera, or upload a video. Talk naturally to the
   camera, in good light, with your face and shoulders in view and nobody else in the picture.
3. **Live consent:** press **Start recording** and read the sentence on screen, including the code, with your face in
   view. ClipWaltz checks automatically that the code was said, that your face is visible and that the voice matches your
   video.
4. Press **Build my presenter**. In a minute or two it shows **Ready**. If the check fails you'll see why — press
   **Get a new code** and record the consent again.

**No video? Make a presenter from a photo of you, or a made-up AI face.** When you create a presenter, choose how:
- **From a video of me** — the steps above. Free, and the most natural result.
- **From a photo of me** — record the live consent (read the sentence and code, facing the camera, centred, in good
  light). Then under **Pick your picture**, play or drag through your recording, pause where you look straight at the
  camera with your mouth closed, and press **Use this frame** — the bright box shows the part that's used. Press **Build
  my presenter · 30 credits**; it's ready in about 20 minutes.
- **AI presenter** — give it a name, a voice and a description of how they look (a made-up person — descriptions of real,
  named people are refused). Press **Make 3 faces**, click the one you like and press **Build with this face · 30
  credits** (about 20 minutes). Don't like any? **New faces** makes three more (up to 3 rounds).

Building from a photo or an AI face costs **30 AI credits**, and they're refunded automatically if it fails. These
presenters speak with the built-in voices — **Your own voice** needs a presenter made from a video of you.

**Big video files:** you can upload a presenter video up to 400 MB; large files upload in pieces automatically.

**Recording yourself — pick your camera and microphone:** when you press **Record with my camera** (or **Start
recording** for the consent), a camera check opens first. Choose the **Camera** and **Microphone** you want (useful if you
have more than one — ClipWaltz remembers your choice on this browser), and watch the mic bar move when you speak. You can
**zoom** in (drag the picture to move it), adjust **brightness**, pick **HD** or **Full HD**, turn the **framing guide**,
**mirror preview** and **3-second countdown** on or off. Press **Record**, then **Stop**, watch your take back, and press
**Use this take** — or **Record again**. Use the same camera and microphone for your video and your consent, so the voice
check matches. If the camera doesn't start, allow camera and microphone access in your browser (the camera icon in the
address bar) and close other apps that may be using it (Teams, Zoom…).

**Use it in a WaltzDeck video:** turn the **Voiceover** on, then under **Presenter (Waltz Avatar)** pick your presenter.
Press **On every voiced scene** (choose **full screen**, **beside the slide** or **corner bubble** first), or set a single
scene's layout to one of the *Presenter* layouts. Render as usual — your presenter speaks each scene's line.

**Cost:** 1 AI credit for every 10 seconds of new presenter speech. Re-rendering lines you haven't changed is free.

**Good to know:** only make a presenter of **yourself**. Every presenter video is labelled **"AI-generated"**. Delete a
presenter at any time (bin icon on its card) — its video, consent recording and saved lip-syncs are removed.

## Waltz Avatar — your own voice, ready-made presenters, translations
- **Your own voice:** on Avatars, under your ready presenter, press **Use my own voice**, read the sentence on screen
  (live, face in view) and press **Check my voice**. Then pick **My voice — <name>** under a WaltzDeck's Voiceover — your
  narration is spoken in your voice, in English, Spanish, French, Italian or Portuguese. **Remove my voice** deletes it.
- **ClipWaltz presenters:** ready-made fictional AI presenters and licensed actors anyone can use — on Avatars, or in a
  deck's presenter picker.
- **Make a video:** press **Make a video** on any presenter, paste your script, choose *Talking head*, *Presenter beside the
  slides* or *Slides with a corner bubble* and a shape. A WaltzDeck project opens, ready to edit and render.
- **Translate a deck:** a WaltzDeck's **Translate** keeps your presenter and your own voice — the translation is spoken by
  you, with your lips matched.
- **Translate a video of yourself:** Waltz AI → **Translate**. Pick a video of you talking (up to 3 minutes), your presenter
  and the language, press **Transcribe & translate** (free), check or edit the translation, then **Make the translated
  video** (2 AI credits per 10 seconds). You need your own voice set up first; we check the video's voice matches yours.
  You can transcribe 2 videos at a time and 20 a day. Cancelling a translation stops it straight away — no credits are used
  and no version is made. To translate again, start a new translation (an old one can't be retried).

## Make videos on your own computer (free)
If your computer has an NVIDIA graphics card (8 GB or more; 10 GB recommended), ClipWaltz can make Waltz AI clips on it
at no AI-credit cost — image → video and talking photos.

1. Connect the computer first (account menu → **AI models → Your computers → Connect a computer**).
2. Install **ComfyUI** (Windows: the portable NVIDIA download) and start it once.
3. For **image → video**, download three files from Hugging Face (Comfy-Org/Wan_2.2_ComfyUI_Repackaged) into ComfyUI's
   models folder: `wan2.2_ti2v_5B_fp16.safetensors` (diffusion_models), `umt5_xxl_fp8_e4m3fn_scaled.safetensors`
   (text_encoders) and `wan2.2_vae.safetensors` (vae).
4. For **talking photos**, install the **ClipWaltz node pack** (github.com/phoenixtekk/ComfyUI-ClipWaltz): in ComfyUI's
   `custom_nodes` folder run `git clone https://github.com/phoenixtekk/ComfyUI-ClipWaltz comfyui-clipwaltz` (or download
   the zip from the same page and unzip it there), then run the two commands in its README (install, then download the
   models — about 12 GB). Update it later with `git pull` in that folder.
5. Restart ComfyUI and the ClipWaltz Connector. **Your computers** now shows what your computer can make.

**Higher-quality talking photos (InfiniteTalk, a 24 GB card):** also download these into ComfyUI's models folder —
from Hugging Face Comfy-Org/Wan_2.1_ComfyUI_repackaged: `wan2.1_i2v_480p_14B_fp8_scaled.safetensors` (diffusion_models),
`wan2.1_infiniteTalk_single_fp16.safetensors` (model_patches) and `wan_2.1_vae.safetensors` (vae); from
Kijai/wav2vec2_safetensors: `wav2vec2-chinese-base_fp16.safetensors` (audio_encoders); from
lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v: `Wan21_I2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors`
(loras). You need ClipWaltz Connector 0.3 or newer. On a smaller card you can start the Connector with `--allow-low-vram`
— it then borrows system memory (64 GB recommended) and is much slower.

Then pick **Your computer** as the model (From image) or under **Render on** (Talking photo — and, if your computer can
run both, the **Engine**: ClipWaltz or InfiniteTalk). Keep ComfyUI and the
Connector running until the clip is done — a home graphics card can take several minutes (on a 10 GB card a 5-second clip from a photo
took about 10 minutes; an 11-second talking photo about 3 minutes). **Cancel** stops it on your computer.

## Organising your projects (categories)
- The **Projects** page has a list of **categories** on the left. Click **All projects**, **Uncategorized** or a
  category to show only those videos on the right. The page remembers your choice in its address, so you can bookmark it.
- **New category:** click **New category** at the bottom of the list (or the folder icon at the top), type a name and
  press Enter. Each new category gets its own colour.
- **Move a video:** drag its card onto a category in the list. To move several, tick the box in the corner of each card
  (it appears when you point at a card), then drag any of them, or use **Move to** in the bar that appears.
- **Manage categories:** double-click a category to rename it, drag the dots on its left to change the order, or use
  its **⋮** menu to rename, change its colour or delete it. Deleting a category never deletes videos — they move to
  **Uncategorized**.
- **Video properties:** on a card, open **⋮ → Properties…** to change the name, description, category and tags in one
  place, and to see its type, format, number of clips and dates.
- **Share to the Community page from Properties:** tick **Show on the Community page** to make the project's latest
  finished version public in the Community feed; untick it to make it private again. It's available once the video has
  been rendered, and only to the person who created the project.
- **Find things fast:** search by name, description or tag, click tags to filter, and sort by last edited, newest,
  name or status.
- On a phone the category list sits above your videos and scrolls sideways; use **Properties** or **Move to** to move
  videos.

## Save your videos to Google Drive, OneDrive or Dropbox
- Open your profile menu → **Cloud storage** and click **Connect** on the service you use. Sign in and allow
  ClipWaltz to save files. You can connect more than one.
- From then on, **every video you finish is saved there automatically**, in a **ClipWaltz** folder. Choose how it's
  organised: **ClipWaltz › Category › Project** (matches your Projects page), **ClipWaltz › Project**, or everything in
  one **ClipWaltz** folder. Files are named like *Spring promo v3 (9x16).mp4* and are never overwritten.
- Turn **Save finished videos automatically** off to stop automatic saves but keep the connection.
- **Save an older version:** in a project's **Render history**, click the cloud button next to any version →
  **Save to …**. A small badge shows each save: spinning while uploading, a tick when done (click it to open the file
  in Google Drive or OneDrive), or a warning if it failed — use **Retry**.
- **If a save fails** (for example your storage is full or the connection expired), it's listed under **Recent saves**
  with the reason; fix it, then press **Retry** or **Reconnect**.
- **Privacy:** ClipWaltz only uploads your finished videos — it never reads or deletes your other files (with Google
  Drive it can only see the files it created). **Disconnect** any time; videos already saved stay in your storage.
- Services marked **Coming soon** aren't switched on yet.

## Choose which videos go where (more than one storage)
- **Default:** on **Cloud storage → Where videos go**, tick the services every finished video should go to. Untick all
  to stop automatic saving.
- **Rules:** click **Add rule** to send some videos somewhere else — by **video type** (music video, ad, slideshow,
  presentation, explainer, campaign pack), **category**, or **format** (9:16, 16:9, 1:1, 4:5). Rules are checked from
  the top; the first that matches decides. A rule with no service ticked means "don't save these". Use the arrows to
  reorder, then **Save**.
- **One project:** open the project's **⋮ → Properties…** → **Save finished videos to** → *Choose for this project*.
- **One video:** when you press **Render HD**, the dialog shows **Save the finished video to** with your rules already
  applied — change it for just this render.
- **Analytics:** **Cloud storage → Analytics** shows how many videos were saved, how much space they use, a day-by-day
  chart, breakdowns by service, video type, format and project, and each service's status and free space. Pick a
  range (7, 30, 90 days or a year); every chart has **Show as table**.

## Importing your media
- If an upload fails, press **Retry** next to the file — large files pick up where they stopped.
- **Drag & drop** files, or use the **file/folder picker**.
- **Connect your phone (USB):** ClipWaltz imports files your computer can see — it does **not**
  read your phone directly.
  1. Plug your phone into your PC with a USB cable.
  2. Your computer opens the phone: **Windows** → *This PC → \[phone] → DCIM*; **Mac** →
     **Photos** / **Image Capture** (iPhone) or **Android File Transfer** (Android).
  3. Select those files in ClipWaltz.
- Uploads are resumable — if your connection drops, they pick up where they left off.

## The editor screen
Both editors (AutoWaltz music videos and WaltzDeck) fit on one screen — nothing to scroll on a computer:
- **Top bar:** the project name, the **sections** (tabs), and on the right **Presets** or **Translate to…**, **Present**
  and **Render HD**.
- **Left panel:** whatever the selected section is about — the brief, music, style, brand, Waltz AI, render…
- **Middle:** the preview. Press **Play**; in WaltzDeck the arrows step scene by scene.
- **Right panel:** the clip or scene you selected — trim, rotate, text, voice, **Edit media**…
- **Bottom:** your files (bottom left) and the **timeline**. Click a clip or scene on the timeline to select it. In
  WaltzDeck the blocks are sized by length and the voice line sits under each scene; drag **Zoom** to widen them.
- **Steps** along the bottom show where you are (add media → edit / plan → review → render). Tap one to jump there.
- On a phone or small tablet the panels stack under each other and the page scrolls.

## Editing & music
- **Sideways clip?** Select the clip on the timeline (its settings open in the right panel) and tap **Rotate 90°** until it's upright (each tap turns it a
  quarter turn clockwise), then **Save**. The preview and your rendered video both use the new rotation. This happens
  when a phone starts recording while pointed at the ground — the video then plays sideways everywhere, not just here.
- **Tags:** select a clip and add tags in the right panel (e.g. "sunset, cesar"). The **Tags** row above the timeline highlights the
  clips with a tag.
- **Google Drive backup:** in the **Footage** box (bottom left), **Connect Google Drive** once, then **Back up … to Drive** copies your
  original uploads to a "ClipWaltz" folder in your Drive (big videos take a few minutes; the button shows progress).
- **Insta360 two-file clips:** some cameras save each lens separately (`…_00_…` and `…_10_…`). Upload **both** and
  ClipWaltz stitches them into one full 360° clip (marked **360° ⧉**); the second file is tucked away.
- **Level horizon on 360 clips:** ClipWaltz reads your Insta360's built-in motion sensor, so the horizon stays
  level even when the camera tilts, bumps or leans through a turn. Nothing to switch on.
- **360 clips (Insta360 .insv):** select the clip on the timeline and pick a **360 view** in the right panel — *Follow action*
  (the default: the view turns toward the movement), *Front* (a steady view out of the lens) or *Tiny planet*.
  Changing it re-makes the clip, which takes a few minutes for long videos. If your camera saved each lens as a
  separate file, upload both (see above) to get the full 360°.
- Choosing an occasion template (or "Surprise me").
- Reordering clips, setting length.
- **Presets:** the **Presets** bar at the top of the editor. Pick a starter look (TikTok Punchy,
  Cinematic, Vlog), a look you saved, or a Featured one — it sets the aspect, length, style,
  effects and overlays in one tap. **Save as preset** snapshots your current look to reuse later;
  star one on your dashboard to make it the default for new projects.
- **Length & "Max footage":** choose a target length, or turn on **♾️ Max — use all footage** to
  make the longest possible video from your clips (every clip at its full length, no repeats). The
  editor shows the projected length, e.g. "~2m 40s from 18 clips."
- **Music side-panel:** browse or search the catalog on the right, tap **▶** to preview any
  track, and tap a track's name to set it as your soundtrack (all licensed, safe to post).

## AutoWaltz — rendering & export
- **Render checkpoint:** when you tap **Render HD** or **Re-render**, a quick confirmation shows
  exactly what will be made — projected length, your Format/Style settings, what you changed since
  the last render, and any heads-up (e.g. no music picked, or clips that don't match the aspect).
  Tap **Confirm** to build it, or **Back to edit** to tweak. You can opt out for quick renders
  (we'll still warn you when something looks off).
- **Ready-to-post text:** turn on **📝 Generate post text** and, when you render, ClipWaltz writes
  a full description you can paste straight to YouTube. Set a **Topic / subject** (what the video is
  about — this guides the AI) and paste your **Channel template** (your standard footer, links and
  hashtags) — both are saved per project, so each project can have its own voice. Leave them blank
  to use the built-in default. Grab it with **Copy post** next to Download after the render.
- Your draft appears in ~30–60s; the HD render runs in the background.
- We'll notify you (in the app and by email) when your video is ready — and, if you turn it on,
  with a desktop notification (see **Account → Notifications** below).
- Downloading and sharing. Videos carry the small ClipWaltz logo in the bottom-left corner —
  music videos, AI clips, enhanced versions, storyboards and exports alike. Free videos always
  have it; whether Plus and Pro videos do is shown on **Account → Billing**. Enhancing,
  assembling or exporting a clip never adds a second logo.

### Photos and clips that don't fill the frame
A tall phone clip in a wide video (or a wide one in a tall video) sits on a soft, blurred copy of itself instead of black
bars. Photos with **Motion** on now take turns zooming in and slowly pulling back.

## Notifications
Renders run in the background, so ClipWaltz can pop a notification the moment yours is done. Open
the avatar menu → **Notifications** (`/account/notifications`) and flip on either or both:
- **Browser notification (while ClipWaltz is open)** — a notification appears whenever you have
  ClipWaltz open in a tab and a render finishes.
- **Windows notification (even when ClipWaltz is closed)** — a desktop toast even if you've closed
  the tab or switched apps. Great for long renders — start it, go do something else, and Windows
  taps you on the shoulder when it's ready.

Your browser will ask permission the first time you enable a notification — choose **Allow**. Both
switches are remembered **per browser and device**, so set them on each computer you use. If a
switch won't turn on, the page tells you why under the switch. Usually Chrome showed the request as a
small bell / "Notifications blocked" icon at the right of the address bar instead of a pop-up, or it
was closed: click that icon (or the icon at the left of the address bar → **Site settings** →
**Notifications**) and choose **Allow**, then turn the switch on again. (These are in addition to the
"video ready" email, which always sends.)
- **Send test notification** (appears once the Windows switch is on) sends a real notification to this
  browser straight away. If no toast appears within a few seconds, check **Windows Settings → System →
  Notifications**: notifications must be on for **Google Chrome** (or your browser) and **Do not
  disturb** must be off.

## Billing & plans
- Free vs Plus vs Pro; how to upgrade (secure Stripe checkout); managing your plan; invoices.

## Community
- **Share** a finished video as Public and it appears in the Community feed; Unlisted gives a
  link-only page; Private keeps it to you.
- **Previews:** every video in the Community feed (and the contest board) shows a still from the video;
  on a computer, point at one to play a silent preview. Click it to watch with sound.
- **Your creator profile** (`/account/profile`): add a bio and links (website, Instagram, TikTok,
  YouTube). Your public page at `/u/<you>` lists all your public videos.
- **Likes & comments:** like any video and leave comments on its watch page.
- **Community chat:** a live room on the Community page for signed-in creators.
- **Monthly Theme Challenge:** each month has a theme. Enter one of your Public videos from the
  editor — likes are votes, and the month's most-liked entry wins **ClipWaltz Pro**.

## Waltz AI — generating AI video
- Open a project and switch to the **Waltz AI** tab. Start from one of your photos (image → video) or
  just describe the scene (text → video), then pick style, camera, motion, shape (landscape,
  portrait or square) and length (3, 5 or 8 seconds) and press **Generate**. Progress updates live.
- **Quality:** *Preview* is a fast draft for trying ideas, *Standard* is the everyday setting, and
  *High* adds detail but takes about 1.5× longer. **Motion** sets how much movement you get —
  *Subtle* for calm scenes, *Dynamic* for energetic ones.
- **Seed** (Advanced settings): leave it blank for a new random take each time, or enter a number
  to recreate a result. **Negative prompt** lists things you don't want, such as "text, watermark".
- If a generation fails you'll see what went wrong in plain words and a **Retry** button that runs
  it again with the same settings. If an option is greyed out it's temporarily switched off — pick
  another quality or check back soon.
- **Presets & suggestions:** your last settings come back next time; **Save current** keeps a named preset you
  can apply with one click. A **Suggested** bar offers a shape, style, camera and motion that fit your photo and
  wording — **Apply** takes them.
- **Edit** on a version loads exactly the settings that made it, so you can change one thing and generate again.
- While a clip is queued you'll see your place in line. The dot at the top shows whether the AI studio is online.
- Every result is saved as a **version**. Preview, compare two side by side, favourite the ones you
  like, **pick** the one to use, or regenerate for a new take.
- **Enhance** a version to make a better copy (your original is kept):
  - **Fast** — quick smoother motion and/or double resolution.
  - **AI upscale** — sharper 2× upscaling and AI smooth motion on our GPU; takes a little longer.
  - **AI Restore** — our highest-quality option: it rebuilds fine detail and doubles the resolution
    (up to 1080p). It takes several minutes per clip. It works best on real camera footage; on
    AI-generated clips it can look over-sharpened — compare it with the original and keep the one you
    prefer. Add **Smoother motion** for a higher frame rate.
- **Enhance presets:** **Clean** (removes grain), **Smooth** (fluid motion), **Sharp** (2× detail) or **Max Quality**
  (AI Restore + smooth motion — slowest). **Custom** lets you choose the engine yourself.
- **Scenes:** plan a short story as scenes (each with a length), pick a version for each with **Use vN**, reorder
  them, then **Assemble** — they're joined into one new "Storyboard" version.
- **Export** any version as MP4 or WebM at its native size, 720p or 1080p, then download it.

## WaltzDeck — ads and slideshows with text
- **New project → WaltzDeck**, pick **Ad**, **Slideshow** or **Presentation** and a shape (vertical, wide, square or 4:5), then **Continue**.
- **Write the brief:** what the video is for, the tone, any offer and your call to action (e.g. "Book at example.com").
  Choose **Text on video**: *Auto* (the AI writes it), *Manual* (you write it) or *Off*.
- **Already have a script?** Paste it into the brief (up to 8,000 characters) as scenes — a `Scene 1` heading,
  optional timing like `0:00–0:05`, then `On-screen text:` and `Voiceover:` lines. WaltzDeck builds one scene per
  heading and uses your timing and words exactly as written; any picture description becomes that scene's suggested
  AI shot.
- **Add your photos and videos.** Give any of them a note and the AI follows it — "show this first", "end on this",
  "say it's organic". Put exact wording in quotes. The AI never invents prices, numbers or claims you didn't give it.
- **Plan my video.** The AI looks at your files and builds a storyboard — one card per scene with the clip, the text
  and a short reason. It takes a minute or two the first time.
- **Make it yours:** edit any text (that scene is then locked so re-planning keeps it), change the layout, the length
  or the clip, reorder, add a text card, or ask the AI to **Rewrite**, make it **Shorter** or **Punchier** — or type
  what you want changed in that scene. **Re-plan** rewrites everything you haven't locked.
- **Brand:** set your colours and fonts, add your logo, and tick **Use my brand on this video**. Your logo appears on
  title and call-to-action cards; the kit is saved for all your videos.
- **Preview** plays the storyboard instantly; **Render HD** makes the final video with your music, on the beat.
- **Voiceover:** in the brief choose *AI writes it* or *I'll write it*, pick a voice (tap **Hear it**) and the speed.
  With AI, plan or re-plan and each scene gets a spoken line; you can edit any line on its card. Scenes get longer
  if a line needs it, and the music dips while the voice speaks.
- **Captions:** leave **Captions** on and each word lights up as it's spoken, in your brand font and colour.

## WaltzDeck presentations — present, export, or start from a deck
- **New project → WaltzDeck → Presentation** makes slides: a title slide, one point per slide with a few bullets,
  and a closing slide. It starts wide (16:9); you can still add photos and videos to any slide.
- **Start from what you have** (top of the brief):
  - **PowerPoint or PDF** — each slide becomes a scene with your own words (locked, so re-planning keeps them),
    your speaker notes and the main picture on the slide. Old *.ppt* files: save as *.pptx* first. Scanned PDFs
    have no text to import.
  - **Web page** — paste your product or landing page and the brief is written from it; its preview picture is
    added to your media. If you already have media, the storyboard is planned straight away.
- **Slide — title + points** is the presentation layout: your headline and points on a brand panel beside the
  photo, or on their own. Type one point per line on the scene card.
- **Speaker notes:** in a presentation each scene card has a notes box. They show when you present, go into the
  PowerPoint's notes, and become the voiceover if you turn the voice on.
- **Present** opens the slides full screen: arrow keys, Space or a click to move, **N** shows your notes, **P**
  plays them automatically, **Esc** leaves.
- **Export → PDF** or **PowerPoint**: one slide per scene, looking just like the video. In PowerPoint the text is
  still editable; video scenes show a still picture. Download it from the same panel when it's ready (a few seconds).
  If the fonts look different in PowerPoint, install the brand font on that computer.

## WaltzDeck campaign packs — find the ad that works
- Once your storyboard is planned, open **4 · Campaign pack**. Choose how many **new hooks** the AI should write, add
  other **calls to action** to test (or let the AI suggest some), and pick the **lengths** (6, 15, 30 s) and
  **shapes**. A pack makes up to 12 videos.
- **Write the options** — in a minute or two you get a draft: each hook with a preview, each call to action. Change
  any wording or clip, remove what you don't like, add your own, and set where the button should go.
- **Render N videos** makes every combination, named like **B2 · 15s · 9:16** (hook B, call to action 2).
- Tick **Share links on** and each video gets its own page with your ad and a button. Share those links — or download
  the videos and use each one's **tracked link** as the destination in your ad platform, so your own analytics show
  which video sent each visitor.
- The table shows **views**, how many **watched to the end**, **clicks** and the **click rate** for each video. Your own
  visits don't count. Once two videos have 10+ views, the leader gets a 🏆.
- **Make more like the winner** starts a new pack that keeps the winning video and asks the AI for fresh hooks in the
  same style — or use ✨ on any row to build on that one.
- On the Free plan, people who press the button first see a short *"You're leaving ClipWaltz"* page showing where the
  link goes, and choose to continue. On Plus and Pro the button goes straight to your site.
- Turn **Share links** off to close all the pages again.

## WaltzDeck — music, voice mix and camera moves
- **Gentle music:** new **Ad** and **Presentation** decks start with a calm, professional track. Find more under
  *gentle* in **Audio → Browse** (Presentation Clean Slide Deck, Gentle Morning Keys, Inspiring and others), or pick any
  other track.
- **Music & voice** (**Audio** tab): choose a track, upload your own (My Music / Upload), or untick **Music in this video**.
  Set the **music level** and **tone**, and — with a voiceover — the **voice level** and **tone**.
- **Music while the voice talks:** *Steady* keeps the music evenly lower under the voice (recommended); *Gentle duck*
  dips it softly; *Strong duck* drops it under every line (punchy ad style).
- **Camera** (in the brief): *Subtle*, *Cinematic* or *Energetic* add camera moves to your photos and clips — push-ins,
  pans, drifts, zoom punches on the beat, handheld shake on action scenes. Your text always stays still. Change the move
  on any scene card (*Camera* menu); press **Play** in the preview to see it.
- **Recent briefs:** press **Recent** next to "What is this video for?" to reuse one of your last 15.
- **Tone:** pick a preset (or *Custom…* to write your own).

## WaltzDeck — crop, rotate, choose the moment, or delete a file
- On any scene with a photo or video, press **Edit media** (under the picture) or tap the picture.
  - **Drag** the picture to choose what shows, and use **Zoom** to crop in closer. **Reset** puts it back in the middle.
    This framing is just for this scene.
  - **Zoom out** below **Fill** to show the whole picture as a card on the scene's backdrop — nothing gets cut off.
    Choose that backdrop under **Backdrop** in the scene panel.
  - **Rotate 90°** turns a sideways photo or clip upright — for every scene that uses that file.
  - For a video, **Which part plays**: leave **Auto** on and ClipWaltz picks the liveliest part, or untick it and slide
    **Start** to the moment you want. **Play** shows you the scene's seconds.
  - Press **Save**. The scene is locked, so **Re-plan** won't undo your changes.
- **Delete from project** (in the same window, or the bin icon on a file in **Your media**) removes the file from this
  project. Scenes that used it become text cards. The file itself stays in your media library.

## WaltzDeck — add, copy and move scenes on the timeline
- Hover between two scenes on the **Timeline** and press the **+** (there's one before the first scene too, and an
  **Add** tile at the end). Pick what to add:
  - **Title card**, **Slide — title + points** or **Call to action**
  - **Photo or video**: any file in this project
  - **Copy scene N here**: a copy of the scene next to it
- Leave **AI writes the words** ticked and the AI writes the new scene so it fits with the scenes around it. Untick it to
  write the words yourself.
- **Move a scene:** drag its block onto a gap between two other scenes.
- **Add a file at a spot:** drag it from **Your media** onto a gap.

## WaltzDeck — backdrops for text slides
- Text-only scenes (titles, end cards, slides without a photo) sit on a **backdrop** in your brand colours.
- **For the whole deck:** open the **Brand** tab → **Text slide backdrop** and pick a style: Brand gradient, Aurora,
  Orbits, Stage, Mesh, Horizon grid, Glass panels, Paper or Bokeh.
  - **Calm / Balanced / Vivid** sets how strong the shapes are. Pick **Calm** for slides with a lot of text.
  - **Shuffle** re-arranges the shapes.
- **For one scene:** select it, open **Backdrop** in the scene panel and pick another style. **Deck default** puts it
  back to the deck's choice.
- **AI backdrop:** pick a look (Keynote glow, Soft aurora, Light rays, Calm workspace, Nature calm, City at dusk, Light
  paper) or **My own** and describe it, then press **Make it**. It costs 2 AI credits (given back if it fails) and is ready
  in about half a minute. It's made in your brand colour with room in the middle for your words. Every AI backdrop you
  make stays in **Your AI backdrops** so you can use it on other scenes. Press × on one to delete it.
- The words always stay readable: the shapes keep away from them and a soft shade sits behind the text. Light
  backdrops (Paper, bright AI images) use dark words.
- With the **Camera** on, backdrops drift slowly in the video.

## AI credits
- AI video (Waltz AI clips, Remix, AI enhance and WaltzDeck's AI fill) uses **AI credits**: **1 credit = 1 second** of AI
  video at standard quality (preview costs half, high quality double). Your plan gives you a monthly allowance —
  **Free 30, Plus 300, Pro 1,000** — that resets on the 1st.
- Every AI button shows what it costs and what you have left. If a job fails or you cancel it, the credits come back.
- See this month's credits on **Account → Billing**. Fast enhance and assembling a storyboard don't use credits.
- **Bonus credits:** sometimes ClipWaltz adds bonus credits to your account (for example after a failed render). They
  show on **Account → Billing** with the reason, count toward this month only, and expire at the monthly reset.

## WaltzDeck — AI fill, brand from your website, other languages
- **Bring to life:** on a scene with a photo, tap **Bring to life** and AI turns it into a short video clip. **Generate
  a shot** makes a new clip from a description (it starts from the scene's text). The clip drops into the scene by itself
  when it's ready — you'll see the progress on the card. Both use AI credits (shown before you start).
- **Brand from your website:** in **Brand**, type your website and press **Read it**. ClipWaltz suggests your colours,
  fonts and logo; press **Use these** to apply them, or **Dismiss**.
- **Language:** pick the language of your deck in the brief (English, Spanish, French, Italian or Brazilian Portuguese) —
  the AI writes in it and the voices speak it.
- **Translate to…** (top bar) makes a copy of your deck in another language: text, voiceover and captions
  translated, same clips and look. Prices, codes and web addresses stay exactly as you wrote them. Your original deck
  isn't changed. (In other languages the word-by-word caption highlight is timed approximately.)

## WaltzDeck — where the voiceover words show
- In a scene's panel, pick **Captions: Top** or **Bottom** (or leave **Deck default**). Each scene can be different — e.g.
  move the words to the top when the bottom of the picture is busy. You can also ask in **Edit with AI**.

## WaltzDeck — "Tell the AI what to change in this scene"
- Type what you want and press Enter. When it's done you'll see **✓ Rewritten.** in green and a pop-up. It can change the
  words, the voiceover and — for animated scenes — the lines the animation uses, e.g. "make the circles laptops and
  iPhones" on a notification-overload scene.

## WaltzDeck — rename your project
- Click the project name at the top of the editor (the pencil), type the new name and press Enter. Escape cancels.

## WaltzDeck — edit your video by chatting with AI
- Press **Edit with AI** (bottom-right of the editor) and say what you'd like: "use the sunset look", "make the opening
  punchier", "add a before / after after scene 2", "delete the last scene", "start over". The AI changes the storyboard
  and tells you what it did — then press **Render the new version**.
- Each change is listed with the scene's headline, so you can check it picked the right one. Drag the corner of the
  message box to make it bigger.
- Locked scenes are never changed. It won't add prices, numbers or web addresses you haven't given it — tell it in the
  chat ("our price is $9 a month") and it can use them.

## WaltzDeck — a different look every time
- Each plan gives your animated scenes a fresh look and new motion. To choose one yourself: **Brand → Animated scenes
  look** (Neon space, Clean light, Bold gradient, Flat paper, Tech grid, Warm sunset, or Auto). **Shuffle** keeps your
  words but gives every animated scene a new take.
- **Film N suggested AI shots** (under Plan) films the real-footage shots the planner suggested, all at once — each one
  goes into its scene when it's ready (about 10 minutes each; the button shows the AI credits).

## WaltzDeck — make an animated explainer
- **New project → WaltzDeck → Explainer.** You don't need any photos or videos: write what your product does and who
  it's for, then press **Plan my video**. The AI writes the scenes and a voiceover, in one glowing look in your brand
  colour.
- **Animated scenes** (pick any of them in a scene's layout list — they work in any deck): apps orbiting a phone,
  notification overload, big words, logo reveal, chat on a phone, one message to every channel, and an end card. The
  boxes under the layout change to say what each one shows — for a chat, write one message per line like
  `Sam: Got it, thanks! (WhatsApp)`, and start your own with `Me:`.
- **Add real footage where it helps:** big words, chat and the end card play over the scene's photo or video. If the
  planner suggested a shot, open **Generate a shot** on that scene — the description is already filled in (each AI
  shot takes about 10 minutes and uses AI credits).
- Press play in the editor to watch the animation; **Render HD** makes the video. Slides (PDF / PowerPoint) show each
  animated scene as a picture.

## WaltzDeck — make the voiceover say your brand name right
- Open **Brand** → **Say it right** → **Add a word**. Type the word as you write it (**TxtYa**) and how it should sound
  (**Text Ya**). Add as many as you need (up to 20), and remove one with the bin.
- The voiceover says it your way; captions and the words on screen still show it as you write it.
- It's saved for your workspace and used by every video with your brand on, the next time you render.
- Tip: spell it out the way it sounds, with spaces between the parts ("Text Ya", "Kwik Pay").

## Waltz AI Remix — make a video you've already made even better
- Open a project → **Waltz AI** tab → **Remix a video**. You'll see every finished video you've made:
  AutoWaltz music videos and Waltz AI clips, from all your projects. Pick one.
- Choose what AI adds (any mix):
  - **Lead-in** — an AI opening that flows straight into your first shot.
  - **Moment magic** — pause the player on a frame and press **Add moment at current frame**; AI
    brings that frame to life for a few seconds, right where it is, so your music video keeps its timing.
    Up to three moments.
  - **Extend** — AI carries the action on after your last frame.
  Each can have its own description ("spray explodes in slow motion…"), or leave it blank.
- Pick a **style** and **quality**, then press **Remix**. It takes a few minutes; you can keep editing.
  The song keeps playing under the AI parts. The remix appears under **Generated versions** — your
  original video isn't changed. You can enhance, export or remix the remix too.
  If your video carries the ClipWaltz logo, the remix shows it once, in the usual corner — the AI parts
  don't copy it.

## Publish — post your videos to social networks
Publish appears in the top bar once it's switched on for your account. Posting and scheduling cost no credits, and
neither does the AI writer. Plus connects up to 10 channels and Pro up to 25.
- **From a video:** every finished video has a **Publish** button: in the Render panel, on each row of Render
  history, on each finished WaltzDeck campaign variant and on each finished Waltz AI export. It opens a new post
  with the video attached and its description written in. ClipWaltz ticks the connected channels that suit the
  video's shape: vertical → TikTok, Instagram Reels and YouTube Shorts; wide → YouTube, LinkedIn and X.
- **Connect networks (Publish → Networks):** press **Connect** on a network and approve ClipWaltz there, or paste
  the details it asks for. The [setup guide](/setup-guide) shows where to find them. Pause a channel to stop posting
  to it without losing the connection; **Check they still work** tests each one. Pinterest asks which board to use
  (change it with **Board**). Workspace owners and admins connect channels. Email destinations are for ClipWaltz
  administrators only. A network whose **Connect** button is greyed out ("Not set up on ClipWaltz yet") can't be
  connected yet — for example TikTok. LinkedIn posts are text only for now.
- **Write a post (Publish → Compose):** type once for every network. Open a network's tab and turn on
  **Write a separate version** to give it its own text. The counter under the text shows each network's limit, and
  the notes under **Channels** tell you before you post if something will be trimmed, left off or refused (for
  example YouTube and TikTok need a video, Pinterest needs an image). **Write it**, **Improve**, **Shorten** and
  **Hashtags** ask the AI to help; read what it wrote before posting. Add images or video up to 200 MB. Big files
  upload in parts, so keep the page open until the bar finishes.
- **When it goes out:** **Publish now**, pick a day and time and **Schedule**, **Save draft**, or **Add to queue**
  for Auto Post. Turn on **Ask an approver** to hold the post until an approver says yes.
- **Posts, Drafts, Favorites, Shared:** see each post's result per channel with a link to it. Use the **⋯** menu to
  publish now, unschedule, **Re-share as a new draft**, copy a **review link** (anyone with it can read the post, not
  change it), approve or reject, or delete. Press **Retry** on a channel that failed. Star posts you want to reuse.
- **Calendar:** month or week view. Drag a post that hasn't gone out yet onto another day to move it (it keeps its
  time).
- **Auto Post:** a rule posts on the days and times you choose: either the next post in your queue, or a new one the
  AI writes from your brief and topics. You can rotate links, add UTM tags, hold AI posts for review first, save
  settings as a preset, and switch a rule off. **Re-Share** lists your published posts to recycle.
- **Post by hand:** Facebook Groups can't be posted to by apps, so those posts wait here ready to go. Copy the text,
  open the group, post it, then press **Mark as posted**.
- **Analytics:** views, likes, comments and shares for the last 90 days, per network and your top posts. Numbers come
  from Facebook, Instagram, Threads and Bluesky and update about once an hour.
- **Comments:** comments on your Facebook, Instagram, Threads and Bluesky posts. Press **Refresh** to fetch the
  latest and **Reply** to answer from the same channel.
- **Who can do what:** everyone in the workspace can read posts, the calendar, analytics, comments and the list of
  networks. **Editors** and above can write posts (Compose), see Drafts, set up Auto Post, use Post by hand and reply to
  comments. **Owners and admins** connect, pause and disconnect networks. If a screen says it is for editors or admins,
  ask a workspace owner to change your role.
- **Email destinations** send at most 200 emails per workspace in any 24 hours, and every email has an unsubscribe
  link in the mail app. A post over the limit shows "Email not sent"; publish it again later.

## Publish — explainer videos, Shorts and your podcast
- **Explainers (Publish → Explainers):** give a topic and a short brief (who it's for, the tone, what to get right).
  ClipWaltz writes a six-part script, records the voice-over, draws the diagrams and captions, and makes the video
  with a thumbnail, YouTube chapters and a description for each network. It takes about ten minutes and costs 10 AI
  credits (you get them back if it fails). Leave **Hold the finished video in Drafts** on to watch it before it goes
  out. To get one on a schedule, make an Auto Post rule that writes posts with AI and turn on **Make a narrated
  explainer video**.
- **Shorts (Publish → Shorts):** a 30–50 second vertical tip video for YouTube Shorts, TikTok and Reels: a hook, a few
  concrete steps and a payoff, with captions that follow the voice. **Make the Short** makes one now (4 AI credits);
  a **Shorts rule** makes one at the times you pick, working through your topics in turn. **Run now** makes the next
  one straight away.
- **Your podcast (Publish → Podcast):** workspace owners and admins create a show (title, description, category).
  ClipWaltz makes a cover; you can upload your own square JPEG (1400–3000 px). Copy the **feed address** and submit
  it once to Apple Podcasts, Spotify and other apps. Each explainer you send to the show becomes an episode: its
  audio is the episode. The table shows downloads per episode, counted once per listener per day and only after a
  minute of listening. No cookies are used and no IP addresses are kept.

## Publish — approvals, best times, client workspaces and planning
- **Approvals:** a workspace owner or admin can turn on **Posts need approval** (your account menu → Workspace →
  Post approvals). Then nothing goes out until it is approved. If you are an editor, **Publish** becomes **Send for
  approval** and **Schedule** schedules it *and* sends it for approval; it goes out at its time once approved. Owners,
  admins and anyone ticked **Approver** on the Workspace page approve posts under **Publish → Approvals** — **Approve**,
  or **Request changes** with a note. The note shows on the post; edit it and send it again. Any edit after approval
  needs approval again. You get a notification (browser and email) when a post waits for you, and when yours is decided.
- **A client can approve without an account:** open the post's menu → **Copy review link** and send it. While the post
  is waiting for approval the page shows **Approve** and **Request changes**. Turning the link off stops it working.
- **Suggested times:** pick channels in the composer and **Suggested times** shows the best slots for each network,
  learnt from how your own posts did over the last 90 days. Click one to fill the day and time. Until a network has 10
  published posts with results it shows general guidance instead, and says so. The calendar shows your learnt slots.
- **Workspaces for clients and brands:** the workspace button in the top bar switches between workspaces and makes new
  ones. Each workspace has its own projects, images, brand kit, social channels, calendar, approvals and members.
  The Pro plan can own up to 5 (your personal one included); Free and Plus have one.
- **Plan a week (Publish → Plan a week):** describe the week (a product, launch or theme), pick channels, days and posts
  per day. ClipWaltz writes a post for each slot from four angles and makes sure no two say nearly the same thing. Read
  and edit them, remove any you don't want, then **Add to the calendar** — they arrive as drafts at suggested times and
  go nowhere until you schedule them. Writing is free; an AI picture on each post costs 2 credits each, and the total is
  shown before you confirm.
- **Copy and hashtags for every network:** in the composer, tick your channels and press **Write copy + hashtags for
  each network**. Each network's tab gets its own version with hashtags that fit it. Free.
- **Engagement estimate:** the composer's checklist tells you what could help (a short first line, a picture, hashtags
  that fit, a question or call to action, a suggested time). Press **AI critique** for a second opinion. A number
  appears only once at least 20 of your published posts have results and the checklist matches how they actually did —
  it is an estimate, not a promise.

## New project — start from a product link
On **New project**, paste a product page into **Start from a product link** and press **Read the page**. ClipWaltz
shows the name, price and how many photos it found. Pick the ad sizes and whether you want a video ad brief, then
**Make the pack**: you get image ads (opened in Waltz Image, with the product photo, name, price and a Shop now
button) and a WaltzDeck video ad ready to plan. Using the product's own photo is free. If the page has no usable photo,
the ads are text on your brand colours — or tick the AI picture option (2 credits each, shown before you confirm). Some
large shops refuse to let ClipWaltz read their pages; then start a design by hand.

## Waltz Image — image ads, carousels and memes
Open **Images** in the top bar (or **New project → Waltz Image**), pick **Image or ad**, **Carousel** or **Meme** and a
shape: square 1:1, portrait 4:5, story 9:16, link/ad 1.91:1 or Pinterest 2:3. Every image comes out at the exact size
each network recommends. You can change the shape later.
- **Pictures:** describe what you want and press **Make with AI** (2 AI credits per picture, refunded if it fails —
  for an image you can ask for up to 4 variations and pick one), or **Upload** your own photo for free. The AI never
  writes words into the picture; your text is added on top so it is always sharp and spelled right.
- **Text is free to change:** headlines, subheads, buttons, slide text and meme text update the preview straight
  away and never use credits. **Use brand kit** applies your brand colours, fonts and logo.
- **Carousels:** start with three slides. Pick a slide below the preview to edit it; **Move left / Move right**,
  **Add slide**, **Duplicate** and **Remove** (2–10 slides). A slide with no picture uses your brand colours (free).
  The last slide shows a button if you fill in **Last slide's button**.
- **Memes:** choose top & bottom text, a caption above, a brand bar or a big quote. Long text wraps and shrinks to fit.
- **Getting it out:** **PNG** / **JPG** download the image (or the slide you're on), **All slides (ZIP)** downloads a
  carousel, **Save to library** adds it to your Media library for use in videos, and **Publish** opens a new post with
  every image attached (carousels post as one multi-image post on Instagram, Facebook and Threads). LinkedIn posts are
  text only for now, so images and PDF carousels aren't sent there yet.
- **Auto AI Image:** a scheduled or Auto Post post with Auto AI Image on gets a picture made from its text just before
  it goes out (2 credits). If the picture can't be made, the post goes out without one and says so.

## Store catalogs — make ads from your shop's products
Account menu → **Store catalogs**. Pick **Shopify**, **WooCommerce** or **Wix**, enter your store's address and press
**Connect and sync** (owners and admins).
- **Shopify and WooCommerce** need no key: ClipWaltz reads the same public product list your storefront shows.
  Password-protected and "headless" Shopify shops can't be read this way.
- **Wix** needs an API key: in Wix, account settings → **API Keys** → **Generate API Key** with the Wix Stores read
  permission for your site, and your site id. The key is stored encrypted and never shown again.
- Your products appear with their name, price and photo. Press **Make a pack** on any product to make image ads and a
  WaltzDeck video ad from it (credits are shown before anything is made; the product's own photo is free).
- **Sync now** brings in new products, updates changed names and prices, and removes products you deleted.
- **Live updates** (Shopify and WooCommerce): follow the steps shown to add a webhook in your store, and products update
  in ClipWaltz as soon as you change them.
- **Disconnect** removes the store, its products and any saved key. Ads you already made stay.

## Export ads for Meta Ads Manager and Google Ads
**Images** → **Export for Meta / Google Ads**. Tick the designs to use, give the campaign a name and landing page, an
optional business name (Google), button (Meta) and primary text, then **Download ZIP**. Inside:
- **meta/** — a spreadsheet for Ads Manager's **bulk import** plus the images. Everything is set to **paused**, so nothing
  runs until you set the audience and budget and turn it on yourself.
- **google/** — a spreadsheet for **Google Ads Editor** (Performance Max asset group) plus the images it can use
  (landscape 1.91:1, square 1:1 and portrait 4:5). Google also needs a logo, which you add in Editor.
- **README.txt** — the import steps, and anything Google still needs (for example more headlines).
Every link carries tracking tags (utm_source, utm_medium, utm_campaign, utm_content) so you can see which ad worked.
ClipWaltz never connects to your ad accounts and never spends money.

## Competitors — see what others post
**Publish** → **Competitors**. Follow a competitor's **blog or news feed** (RSS/Atom), **Bluesky** account or
**Mastodon** account. You see their last 20 posts with dates and how often they post. **AI summary** (free) describes
their main themes, when they post, the hooks they reuse and ideas to try that are different. Only public posts are
read, through each network's official public API or the site's own feed. Facebook, Instagram, X, LinkedIn, TikTok,
YouTube and the Meta Ad Library can't be followed — the page says why.

## API and AI assistants (Pro)
Account menu → **API keys** (owners and admins on Pro). Create a key with the permissions it needs — **Read**,
**Generate**, **Publish** — and copy it straight away; it's shown once. Use it from your own scripts with the
[API guide](/help/api), or connect an AI assistant such as Claude to ClipWaltz over MCP with the setup shown on the
page. The key acts as you, AI pictures use your credits, and **Revoke** stops it at once.

## Install ClipWaltz on your phone or computer
ClipWaltz can be installed like an app. On Android (Chrome) open the menu → **Install app** (or **Add to Home
screen**); on iPhone/iPad (Safari) tap **Share** → **Add to Home Screen**; on a computer, use the install icon in Chrome
or Edge's address bar. It opens in its own window, keeps your notifications, and shows a "You're offline" page instead
of an error when there's no connection.

## Working with others (workspaces)
- Open the **account menu → Workspace** to invite people by email. Pick a role:
  **Viewer** (watch and download only), **Editor** (edit, upload, render and generate) or, if you're
  the owner, **Admin** (also deletes projects and manages members).
- The invite link works once, for 7 days, and only for the email address you invited — the person
  signs in (or creates an account) with that address and clicks **Accept invite**. Invite them again to
  send a fresh link; the old one stops working.
- Shared workspaces appear as tabs at the top of **Projects**. Pick one to see its projects, and use
  **New Project** there to create a project everyone in it can open.
- Change someone's role or remove them from the Workspace page at any time — removal takes effect
  immediately. If you were invited, you can **Leave** a workspace from the same page.

## Feedback
- Open the account menu (your initial, top right) → **Send feedback**. Pick Idea, Something's broken,
  I like this or Other, write a line or two and press **Send**. The page you were on is included so we
  can see what you mean. Every message is read.

## Account
- Profile, password reset, retention (free sources auto-delete after 7 days; paid "Project Vault"
  keeps them).
