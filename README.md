# DriveSense AI — Driver Monitoring Demo

A browser-based demonstration dashboard for driver attention and fatigue indicators.

## Run locally

Open this folder with VS Code and use the Live Server extension, or run a local web server. Camera access requires HTTPS or localhost and browser permission. An internet connection is needed to load the MediaPipe model.

## Publish with GitHub Pages

1. Open this repository and select **Settings**.
2. Select **Pages** from the left menu.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **main** and folder **/(root)**, then press **Save**.
5. Wait for GitHub Pages to finish publishing. The website URL will appear on the Pages settings screen.

## Important limitation

This is an experimental browser demo using MediaPipe face landmarks and simple heuristics. It is not the original Python model, is not a validated driver-safety product, and must not be used to make real driving safety decisions. The demo processes the camera stream in the browser.
