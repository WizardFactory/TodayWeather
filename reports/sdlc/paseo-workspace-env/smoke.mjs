// Installed Paseo lifecycle against synthetic data in an isolated Git worktree.
import {mkdtemp, mkdir, writeFile, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {seedPaseoConfigFile, runWorktreeSetupCommands} from '/root/.nvm/versions/node/v22.22.2/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/utils/worktree.js';
import {readPaseoConfigForEdit} from '/root/.nvm/versions/node/v22.22.2/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/utils/paseo-config-file.js';

const root = resolve('.');
const temp = await mkdtemp(join(tmpdir(), 'tw-paseo-env-smoke-'));
const source = join(temp, 'source checkout');
const target = join(temp, 'new workspace');
const git = (args, cwd = source) => execFileSync('git', args, {cwd, stdio: 'pipe'});
let added = false;
try {
    await mkdir(source);
    git(['init', '-q']);
    await writeFile(join(source, 'README'), 'Synthetic setup fixture\n');
    git(['add', 'README']);
    git(['-c', 'user.name=Setup Test', '-c', 'user.email=setup@example.invalid', 'commit', '-qm', 'fixture']);
    await mkdir(join(source, 'server'));
    await writeFile(join(source, 'server/.env'), "SERVER_MODE=service\nDUMMY_SECRET='smoke-only'\n");
    await writeFile(join(source, 'paseo.json'), await readFile(join(root, 'paseo.json')));
    assert.equal(readPaseoConfigForEdit(source).ok, true);
    git(['worktree', 'add', '--detach', target, 'HEAD']);
    added = true;
    await seedPaseoConfigFile({sourceCwd: source, targetCwd: target});
    assert.deepEqual(await readFile(join(target, 'paseo.json')), await readFile(join(source, 'paseo.json')));
    // Let Paseo infer the original repository from the real worktree metadata.
    const results = await runWorktreeSetupCommands({worktreePath: target, branchName: 'HEAD', cleanupOnFailure: false});
    assert.equal(results.length, 1);
    assert.equal(results[0].exitCode, 0);
    assert.ok(!JSON.stringify(results).includes('smoke-only'));
    assert.deepEqual(await readFile(join(target, 'server/.env')), await readFile(join(source, 'server/.env')));
    assert.equal((await stat(join(target, 'server/.env'))).mode & 0o777, 0o600);
    git(['check-ignore', '--quiet', 'server/.env'], target);
    console.log('PASS installed Paseo parser, config seed, inferred source path, actual worktree setup, bytes, mode and Git ignore');
    await writeFile(join(target, 'paseo.json'), '{}\n');
    await seedPaseoConfigFile({sourceCwd: source, targetCwd: target});
    assert.equal(await readFile(join(target, 'paseo.json'), 'utf8'), '{}\n');
    console.log('PASS existing target configuration precedence is preserved');
} finally {
    if (added) git(['worktree', 'remove', '--force', target]);
    await rm(temp, {recursive: true, force: true});
}
