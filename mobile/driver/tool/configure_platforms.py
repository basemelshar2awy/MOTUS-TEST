#!/usr/bin/env python3
"""Adjusts the Android and iPhone projects that `flutter create` generates for the MOTUS driver app:
app name, permissions (internet, location while a trip runs), the two Android store flavors (google = Google Play with Firebase,
huawei = AppGallery with Huawei Push Kit) and Arabic as a supported language on iPhone.
Safe to run more than once."""
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
APP_NAME = 'MOTUS Driver'


def patch(path, fn):
    p = root / path
    if not p.exists():
        print(f'skip (missing): {path}')
        return
    before = p.read_text(encoding='utf-8')
    after = fn(before)
    if after != before:
        p.write_text(after, encoding='utf-8')
        print(f'patched: {path}')


# ---------- Android ----------
def manifest(s):
    if 'android.permission.INTERNET' not in s:
        s = s.replace('<application', '<uses-permission android:name="android.permission.INTERNET"/>\n    <application', 1)
    for perm in ('ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'):
        if f'android.permission.{perm}' not in s:
            s = s.replace('<application', f'<uses-permission android:name="android.permission.{perm}"/>\n    <application', 1)
    if '<queries>' in s and 'android:scheme="https"' not in s:
        s = s.replace('<queries>', '<queries>\n        <intent>\n            <action android:name="android.intent.action.VIEW"/>\n            <data android:scheme="https"/>\n        </intent>', 1)
    s = re.sub(r'android:label="[^"]*"', f'android:label="{APP_NAME}"', s, count=1)
    if '<queries>' in s and 'android.intent.action.DIAL' not in s:
        s = s.replace('<queries>', '<queries>\n        <intent>\n            <action android:name="android.intent.action.DIAL"/>\n            <data android:scheme="tel"/>\n        </intent>', 1)
    return s


patch('android/app/src/main/AndroidManifest.xml', manifest)

FLAVORS_KTS = '''
// MOTUS: one app, two Android stores
android {
    flavorDimensions += "store"
    productFlavors {
        create("google") {
            dimension = "store"
        }
        create("huawei") {
            dimension = "store"
            versionNameSuffix = "-hms"
        }
    }
}
'''
FLAVORS_GROOVY = '''
// MOTUS: one app, two Android stores
android {
    flavorDimensions "store"
    productFlavors {
        google {
            dimension "store"
        }
        huawei {
            dimension "store"
            versionNameSuffix "-hms"
        }
    }
}
'''


def gradle(flavors):
    def fn(s):
        if 'productFlavors' in s:
            return s
        return s.rstrip() + '\n' + flavors
    return fn


patch('android/app/build.gradle.kts', gradle(FLAVORS_KTS))
patch('android/app/build.gradle', gradle(FLAVORS_GROOVY))

# ---------- iPhone ----------
def plist(s):
    if '<key>CFBundleDisplayName</key>' in s:
        s = re.sub(r'(<key>CFBundleDisplayName</key>\s*<string>)[^<]*(</string>)', rf'\g<1>{APP_NAME}\g<2>', s, count=1)
    else:
        s = s.replace('<dict>', f'<dict>\n\t<key>CFBundleDisplayName</key>\n\t<string>{APP_NAME}</string>', 1)
    if '<key>CFBundleLocalizations</key>' not in s:
        s = s.replace('<dict>', '<dict>\n\t<key>CFBundleLocalizations</key>\n\t<array>\n\t\t<string>ar</string>\n\t\t<string>en</string>\n\t</array>', 1)
    if '<key>LSApplicationQueriesSchemes</key>' not in s:
        s = s.replace('<dict>', '<dict>\n\t<key>LSApplicationQueriesSchemes</key>\n\t<array>\n\t\t<string>tel</string>\n\t</array>', 1)
    if '<key>NSLocationWhenInUseUsageDescription</key>' not in s:
        s = s.replace('<dict>', '<dict>\n\t<key>NSLocationWhenInUseUsageDescription</key>\n\t<string>MOTUS shares your location with your company only while your trip is running. / بيتبعت مكانك للشركة وقت الرحلة بس.</string>', 1)
    if '<string>https</string>' not in s:
        s = s.replace('<string>tel</string>', '<string>tel</string>\n\t\t<string>https</string>', 1)
    return s


patch('ios/Runner/Info.plist', plist)
print('done')
