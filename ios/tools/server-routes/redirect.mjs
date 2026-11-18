// Preloaded by generate.py (`node --import`): the Android route generator writes its table to the iOS path given in
// TW_ROUTES_OUT instead of android/, with the iOS tool named as the generator. Any other write fails, and so does a run
// in which the table was not written exactly once, so a changed Android generator cannot write into android/ unnoticed.
import fs from 'node:fs';
import path from 'node:path';

const target = process.env.TW_ROUTES_OUT;
const generator = process.env.TW_ROUTES_GENERATOR;
if (!target || !generator) throw new Error('TW_ROUTES_OUT and TW_ROUTES_GENERATOR must be set');
const ANDROID_OUT = path.join('android', 'core-data', 'src', 'test', 'resources', 'server-routes', 'routes.json');

const writeFileSync = fs.writeFileSync;
let written = 0;
fs.mkdirSync = () => undefined;
fs.writeFileSync = (file, data, ...rest) => {
    if (typeof file !== 'string' || !file.endsWith(ANDROID_OUT)) throw new Error(`unexpected write of ${file}`);
    const table = JSON.parse(data);
    table.generator = generator;
    written += 1;
    return writeFileSync(target, JSON.stringify(table, null, 1) + '\n', ...rest);
};
process.on('exit', (code) => {
    if (code === 0 && written !== 1) {
        console.error(`the route table was written ${written} times, expected once`);
        process.exitCode = 1;
    }
});
