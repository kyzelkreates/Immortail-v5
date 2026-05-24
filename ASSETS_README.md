# IMMORTAIL™ Asset Paths

Drop your real media files here. The system falls back to the SVG dog automatically
when any asset is missing — no errors thrown, no crashes.

## Directory Structure

```
assets/
  dog/
    body_idle.png        ← Dog body, neutral state
    body_happy.png       ← Dog body, happy/bond-high state  
    body_sad.png         ← Dog body, low energy state
    eyes_idle.png        ← Eyes overlay, neutral
    eyes_happy.png       ← Eyes overlay, happy (wide + bright)
    eyes_sad.png         ← Eyes overlay, sad (droopy)
    tail_wag.webm        ← Micro loop: fast tail wag (happy/idle)
    blink.webm           ← Micro loop: eye blink (idle)
    bounce.webm          ← Micro loop: body bounce (excited)
    ear_flick.webm       ← Micro loop: ear flick (idle/curious)
  audio/
    bark_soft.mp3        ← Soft single bark (happy response)
    bark_excited.mp3     ← Excited bark sequence (play/excited)
    whine.mp3            ← Soft whine (sad state)
    breath_idle.mp3      ← Ambient breathing loop (idle)
  icons/
    icon-192.png         ← PWA icon 192x192
    icon-512.png         ← PWA icon 512x512

```

## Image specs
- PNG with transparency (RGBA)
- Recommended size: 400x400px or 512x512px
- Images are positioned with `object-fit: contain` inside the 200x200 stage

## Video specs
- WebM format, VP8 or VP9 codec
- Transparent background (alpha channel) if overlaying SVG
- Loop duration: 0.5s – 2s
- No audio track in video files (audio handled separately)

## Audio specs
- MP3, 44.1kHz, mono or stereo
- Duration: 0.5s – 3s
- Volume will be normalised by the audio system

## Expression → Asset Mapping

| Expression | Body image      | Eyes image      | Video overlay  | Audio              |
|------------|-----------------|-----------------|----------------|--------------------|
| idle       | body_idle.png   | eyes_idle.png   | blink.webm     | breath_idle.mp3    |
| happy      | body_happy.png  | eyes_happy.png  | tail_wag.webm  | bark_soft.mp3      |
| sad        | body_sad.png    | eyes_sad.png    | (none)         | whine.mp3          |
| excited    | body_happy.png  | eyes_happy.png  | bounce.webm    | bark_excited.mp3   |
