# Android: `textShadowRadius` is taken in pixels, and `textShadowRadius: 0` draws no shadow

![Build](https://github.com/YevheniiKotyrlo/rn-android-text-shadow-radius/workflows/Pre%20Merge%20Checks/badge.svg)

React Native 0.90.0-nightly-20261124-ad969b283, from the [React Native reproducer template](https://github.com/react-native-community/reproducer-react-native). `App.tsx` renders three black `Text`s with a red `textShadowColor` on white:

1. `textShadowOffset: {width: 0, height: 0}`, `textShadowRadius: 8`;
2. `textShadowOffset: {width: 4, height: 4}`, `textShadowRadius: 0`;
3. `textShadowOffset: {width: 4, height: 4}`, `textShadowRadius: 1`.

## Steps

By hand, on an Android device:

1. Build and install the release APK: `cd ReproducerApp/android && ./gradlew assembleRelease && adb install -r app/build/outputs/apk/release/app-release.apk`.
2. Open the app. The second text draws no shadow, where the third draws a sharp red one.
3. `adb shell wm density 160`, open the app again, then `adb shell wm density reset`. At 160 dpi, where a dp is a pixel, the first text is smaller by the density's factor, and its red blur reaches about as many pixels past the glyphs as at the device's own density.

Scripted: `./reproduce.sh`, with one Android device of at least 320 dpi attached, builds and installs the app, takes a screenshot at the device's own density and one at 160 dpi (putting the density back on exit), and measures how far the first text's shadow reaches past its glyphs and how many red pixels the second and third texts' shadows draw. It exits 1 while the blur reaches about the same number of pixels at both densities or `textShadowRadius: 0` draws no shadow, 0 once neither holds, and 2 when a step fails. The screenshots land in `screenshots/`.
