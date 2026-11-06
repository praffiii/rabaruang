# RabaRuang

Lets a student with a disability follow what a lecturer draws on the board, using only their own phone.

- **Raba** (blind students): photograph the board, then slide a finger across the screen. Lines play a tone whose pitch follows their height, and labels and formulas are read aloud where the finger is.
- **Sorot** (Deaf students): the lecturer's words appear as a caption attached to the part of the board photo being discussed.

## Run it

It is a static site with no build step. Serve the folder over HTTPS or localhost, because the camera and microphone need a secure page.

```bash
python3 -m http.server 8000
node --test
```

Photos are read by Gemini, using a key each user pastes into the app. The key stays in that browser's local storage. The sample boards need no key.

## Known limitations

- Sample boards and the sample lecture are simulated and are labelled as samples in the app.
- AI readings are not verified, and the app says so aloud on every real photo.
- When the lecturer says only "ini" or "itu", the words do not say where. Sorot marks those captions as a guess.
- Web vibration depends on the phone and is unavailable in iPhone browsers.
- Not yet tested by blind or Deaf students.

## AI assistance

Built with Claude Code. Board reading at runtime uses Google Gemini.
