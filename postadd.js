// Runs once after `npx cap add ios`. Sets the app's name, screen directions, the sentences iOS shows
// when TwoFrame asks for Photos, camera or microphone, and other settings App Store review expects.
const fs = require('fs'), path = require('path');
const plistPath = path.join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist');
let src = fs.readFileSync(plistPath, 'utf8');
const start = src.indexOf('<dict>') + 6, end = src.lastIndexOf('</dict>');
const body = src.slice(start, end), entries = [], positions = [], tagRe = /<key>([^<]*)<\/key>\s*/g;
let m; while ((m = tagRe.exec(body))) positions.push({ key: m[1], valStart: m.index + m[0].length, keyStart: m.index });
for (let i = 0; i < positions.length; i++) { const valEnd = i + 1 < positions.length ? positions[i + 1].keyStart : body.length; entries.push([positions[i].key, body.slice(positions[i].valStart, valEnd).trim()]); }
function set(key, valueXml) { const e = entries.find(x => x[0] === key); if (e) e[1] = valueXml; else entries.push([key, valueXml]); }
const str = (s) => '<string>' + s.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</string>';
set('CFBundleDisplayName', str('Maximum'));
set('UISupportedInterfaceOrientations', '<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>');
set('UISupportedInterfaceOrientations~ipad', '<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t\t<string>UIInterfaceOrientationPortraitUpsideDown</string>\n\t\t<string>UIInterfaceOrientationLandscapeLeft</string>\n\t\t<string>UIInterfaceOrientationLandscapeRight</string>\n\t</array>');
set('NSPhotoLibraryUsageDescription', str('Maximum opens the videos and photos you pick so you can edit them. They stay on your phone.'));
set('NSPhotoLibraryAddUsageDescription', str('Maximum saves your finished videos to your photo library.'));
set('NSCameraUsageDescription', str('Maximum records video when you ask it to.'));
set('NSMicrophoneUsageDescription', str('Maximum records voiceover when you ask it to.'));
set('ITSAppUsesNonExemptEncryption', '<false/>');
set('LSApplicationCategoryType', str('public.app-category.photography'));
set('UIDeviceFamily', '<array>\n\t\t<integer>1</integer>\n\t\t<integer>2</integer>\n\t</array>');
const out = src.slice(0, start) + '\n' + entries.map(([k, v]) => '\t<key>' + k + '</key>\n\t' + v).join('\n') + '\n' + src.slice(end);
fs.writeFileSync(plistPath, out);
fs.copyFileSync(path.join(__dirname, 'PrivacyInfo.xcprivacy'), path.join(__dirname, '..', 'ios', 'App', 'App', 'PrivacyInfo.xcprivacy'));
for (const f of ['TFNativePlugin.swift', 'TFBridgeViewController.swift']) fs.copyFileSync(path.join(__dirname, '..', 'native', f), path.join(__dirname, '..', 'ios', 'App', 'App', f));
console.log('Info.plist patched, privacy manifest and native files copied.');
