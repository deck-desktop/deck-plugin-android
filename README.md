# Android for Deck

The phone plugged into your PC, or connected over Wi-Fi, in a tab: its screen, live and in your
hands, its log beside it, and the things you reach for while developing an app. Open it from the
**+** beside your tabs and choose **Android**.

## What it does

- **The phone's screen, live,** at up to 60 frames a second. Deck runs
  [scrcpy](https://github.com/Genymobile/scrcpy)'s server on the phone for it.
- **Use the phone from the PC.** Click and drag on the screen to tap and swipe, scroll with the
  wheel, and with the screen focused, type on the phone with your keyboard. Back, Home, Recent
  apps, the volume keys and the power key are buttons above it.
- **Its log**, beside the screen: logcat, filtered by lowest level (Verbose to Errors), by one app
  (its package name, followed across restarts), and by a search. It keeps to the bottom while you
  are there, and can be cleared.
- **Screenshots and screen recordings**, one click each (a recording stops by itself after three
  minutes). They are saved to `Pictures\Android` and `Videos\Android`, and a notification opens
  them.
- **Install an APK** on the phone from a file on the PC.
- **Over Wi-Fi.** Pair a phone with the address and code its Wireless debugging screen shows, then
  connect. Where the network lets adb find the phone, the addresses are filled in for you. Deck
  remembers the last five addresses and reconnects by itself while no phone is connected.
- **Several phones**: pick which one from the list above the screen.
- The controls and the log can each be hidden, to give the screen the whole tab.

## Needs

- **USB debugging** on the phone (Settings › Developer options), or **Wireless debugging** for
  Wi-Fi. The first time, the phone asks whether to trust this PC.
- **adb**, from Google's Android platform tools. If Deck cannot find it, the tab offers to download
  it (about 8 MB) into the plugin's own folder; nothing else on the PC changes.

The first time a screen starts, Deck downloads scrcpy's server (version 5.0.1) from its GitHub
release, checks it against its published checksum, and keeps it in the plugin's folder.

What is shown and the Wi-Fi addresses are kept in Deck's config, as `view` and `wireless`.

## Permissions

- **processes:** to run adb.
- **network:** to download scrcpy's server and adb, and to talk to the server on the phone through
  adb, on this PC only.
- **files:** to save screenshots and recordings and to keep what it downloaded.
