# Maximum Video Editor iPhone app

The app is sold as **Maximum Video Editor** (home screen name: Maximum). Inside the code it is still called TwoFrame, and the bundle ID keeps `twoframe`; users never see either.

This repository builds the TwoFrame iPhone app on Codemagic. The editor itself is `index.html`, the same
file as the website. The app adds a native helper (`native/`) that uses Apple’s own on-device cutout for
Remove Background, checks the phone before each use, and saves exports to Photos.

## Files
- `index.html`, `community.json`: the editor. Replace both whenever the website gets a new build.
- `icon.png` (1024 × 1024) and `splash.png` (2732 × 2732): app icon and launch screen.
- `native/TFNativePlugin.swift`: the phone check, Apple’s person cutout (video) and subject cutout (photos), saving.
- `native/TFBridgeViewController.swift`: registers the helper with the app.
- `scripts/`: patches the Xcode project during the build (name, permissions text, iOS 17 minimum, privacy manifest).
- `codemagic.yaml`: the cloud build. It sends each build to TestFlight.

## One-time setup (from a Windows PC)
1. Make a new GitHub repository (for example `twoframe-ios`) and upload every file and folder here to it.
2. In the Apple Developer site, under Identifiers, register the bundle ID `com.comicbookhistorians.twoframe`.
3. In App Store Connect, create a new app with that bundle ID, named Maximum Video Editor. Check first that nobody else uses that name for a video app (App Store search and a trademark search).
4. In Codemagic, add the new repository. It uses the same App Store Connect integration named “Codemagic” as the games.
5. Start the “Maximum iOS build” workflow. When it finishes, the build appears in TestFlight in App Store Connect;
   add yourself as a tester and install it from the TestFlight app on the iPhone.

## Minimum iPhone
iOS 17, which means iPhone XS, XS Max, XR, SE (2nd generation) and newer.

## Before sending it for App Store review
The Retouch and caption tools still load their code from the internet the first time they are opened. Apple’s
rule 2.5.2 does not allow that in an App Store app, so those libraries must be put inside the app first
(see docs/APP-STORE.md in the main project). TestFlight testing is fine as it is.
