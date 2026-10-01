# Nova Android app (Trusted Web Activity)

Thin, auditable wrapper: Chrome renders https://licenzpol.it/nova inside a full-screen Trusted Web Activity. No WebView, no JavaScript bridge, no permissions of its own, no analytics. Package `it.licenzpol.nova`.

Build (any machine with JDK 17 + Android SDK 35; production build runs on the LicenzPol VM in `/opt/android-build`):
```bash
export JAVA_HOME=/opt/android-build/jdk ANDROID_HOME=/opt/android-build/sdk
# first time: generate the release keystore (kept OUT of git, in /opt/nova-community/data/keystore/)
keytool -genkeypair -v -keystore nova-release.jks -alias nova -keyalg RSA -keysize 4096 -validity 10000 -storepass "$PW" -keypass "$PW" -dname "CN=Nova, O=Nova Community, L=Bologna, C=IT"
export NOVA_KEYSTORE=/opt/nova-community/data/keystore/nova-release.jks NOVA_KEYSTORE_PASSWORD=… NOVA_KEY_PASSWORD=… NOVA_KEY_ALIAS=nova
cd android && gradle wrapper --gradle-version 8.11.1 && ./gradlew --no-daemon :app:assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```
After the first build, publish the signing certificate fingerprint so Android trusts the site (hides the browser UI):
`keytool -list -v -keystore nova-release.jks -alias nova | grep SHA256` → put it in `/opt/nova-community/data/assetlinks.json` (served at `https://licenzpol.it/.well-known/assetlinks.json` by the app).
Losing the keystore means users cannot update the app: back it up with the data directory.
