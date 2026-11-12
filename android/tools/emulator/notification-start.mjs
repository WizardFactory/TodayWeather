#!/usr/bin/env node
// Marks the running Cordova build's start page as done (`TwStorage.set('startVersion', Util.startVersion)`, as
// controller.start.js does when S01 closes), so the seeded user opens on the tabs (run-notification-check.sh).
//   node notification-start.mjs <emulator-serial>
import {connect} from './devtools.mjs';

const serial = process.argv[2];
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial');
const dt = await connect(serial);
await dt.settled();
console.log(await dt.evaluate(`(function () {
    var inj = angular.element(document.body).injector();
    inj.get('TwStorage').set('startVersion', inj.get('Util').startVersion);
    return 'startVersion ' + localStorage.getItem('startVersion');
})()`));
dt.close();
