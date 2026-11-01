// after_prepare: Xcode 27 rejects Pods targets below its supported range, and some pods still
// declare iOS 12. The app minimum already applies at runtime, so raise only the lower targets.
const fs = require('node:fs');
const path = require('node:path');

const parts = version => version.split('.').map(Number);
function isLower(version, minimum) {
    const [a, b] = [parts(version), parts(minimum)];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
    }
    return false;
}

module.exports = function(context) {
    if (!(context.opts.platforms || []).includes('ios')) return;
    const root = context.opts.projectRoot;
    const file = path.join(root, 'platforms/ios/Pods/Pods.xcodeproj/project.pbxproj');
    if (!fs.existsSync(file)) return;
    const config = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');
    const minimum = (config.match(/<preference name="deployment-target" value="([\d.]+)"/) || [])[1];
    if (!minimum) throw new Error('iOS deployment-target preference is missing from config.xml.');
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g, (line, version) =>
        (isLower(version, minimum) ? `IPHONEOS_DEPLOYMENT_TARGET = ${minimum};` : line));
    if (next !== text) fs.writeFileSync(file, next);
};
