# Android

A tab for the phone plugged into your PC, or connected over Wi-Fi: its screen, live and in your
hands, its log beside it, and the things you reach for while developing an app.

## What it does

- **The phone's screen, live.** It plays at the phone's frame rate (about 30 to 60 frames a
  second) and is sharp: Deck runs [scrcpy](https://github.com/Genymobile/scrcpy)'s server on the
  phone for it.
- **Use the phone from the PC.** Click and drag on the screen to tap and swipe, scroll with the
  wheel, and with the screen focused, type on the phone with your keyboard. Back, Home, Recent
  apps, the volume keys and the power key are buttons above it.
- **Its log**, beside the screen: logcat, filtered by level (Verbose to Errors), by one app (its
  package name), and by a search. It scrolls with new lines while you are at the bottom.
- **Screenshots and screen recordings**, one click each. They are saved to `Pictures\Android` and
  `Videos\Android`, and a notification opens them.
- **Install an APK** on the phone from a file on the PC.
- **Over Wi-Fi.** Pair a phone with the address and code its Wireless debugging screen shows, then
  connect. Deck remembers the address and reconnects by itself while no phone is connected.
- The controls and the log can each be hidden, to give the screen the whole tab.

## What it needs

- **USB debugging** on the phone (Settings › Developer options), or **Wireless debugging** for
  Wi-Fi. The first time, the phone asks whether to trust this PC.
- **adb**, from Google's Android platform tools. If Deck cannot find it, the tab offers to download
  it (about 8 MB) into the plugin's own folder; nothing else on the PC changes.
- Android 11 or newer for the live screen.

The first time a screen starts, Deck downloads scrcpy's server (version 5.0.1) from its GitHub
release, checks it against its published checksum, and keeps it.

## Permissions

- **processes:** to run adb.
- **network:** to download scrcpy's server and adb, and to talk to the server on the phone through
  adb, on this PC only.
- **files:** to save screenshots and recordings and to keep what it downloaded.

## Developing

```sh
npm run dev            # rebuild as you edit; each save shows in your test Deck
npm run install-local  # when it is done: install it into your real Deck
npm test               # the checks
```

Start a test Deck from Settings › Plugins › Open a test Deck: it keeps its own settings and data,
so trying the plugin never touches your real Deck. `src/plugin.tsx` is the entry point; its
default export is the tab.
