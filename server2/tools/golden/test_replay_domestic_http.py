"""B3 inert synthetic controls. Run only after root grants controls/CPU authorization.

No original export, legacy handler, collector or application model is executed.
Focused vendor controls load the pinned Mongoose SDK with transport blocked.
Original full corpus bytes are read as data to exercise all five structural validators.
These checks do not establish current legacy/native semantic parity.
"""
from copy import deepcopy
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import replay_domestic_http as d

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / d.EVIDENCE
NODE = EVIDENCE.parent / 'phase2-toolchain/runtime/node-v16.20.2-darwin-arm64/bin/node'
FIXTURES = {'kma': 'domestic/fixtures/oracle.json.gz', 'older': 'legacy_versions/fixtures/kma-older.json.gz', 'town': 'legacy_versions/fixtures/kma-town.json.gz', 'core': 'domestic/fixtures/s3-response.json.gz', 'rich': 'domestic/fixtures/s3-rich-response.json.gz'}
RICH_SYNTHETIC_METADATA = {
    'server2/tools/golden/kma_s3_rich/package.json': 'manifest_sha256',
    'server2/tools/golden/kma_s3_rich/package-lock.json': 'lock_sha256',
}

# Source-derived exact official Node16 internal util helper; no runtime extraction.
NODE_STRUCTURED_STACK_CODE = "(function() {\n      try { Error.stackTraceLimit = Infinity; } catch {}\n      return function structuredStack() {\n        const e = new Error();\n        overrideStackTrace.set(e, (err, trace) => trace);\n        return e.stack;\n      };\n    })()"
NODE_STRUCTURED_STACK_ENTRY = {'filename': 'structured-stack', 'sha256': '74624fddc8f672961098f19cb2afcbff94c92d21ceb1540c96eaba77d9479b51'}

PINNED_ETAG_SOURCE = EVIDENCE / 's02-deps-v2/node_modules/etag/index.js'
PINNED_ETAG_MAP = EVIDENCE / 'offline-install2/root-qualification1/s02-installed-files.json'
PINNED_ETAG_MAP_SHA256 = '786d38f88b924ceae06eb6c5cad71f0ef12cb2514f42ba1a2067de4e40107528'
PINNED_ETAG_SOURCE_SHA256 = 'c9cfea21bc1f26e054e8f24cb9967211cb32e2fc31a2df64d4bead2dd3e29ae9'
PINNED_ETAG_EXPECTED = 'W/"9-Xwa4XhYZsri1b3t1igoxCg"'
VERIFIED_S02_ROOT = EVIDENCE / 's02-deps-v2'
VERIFIED_S02_MAP = PINNED_ETAG_MAP
VERIFIED_ASYNC_PARENTS = {
    'raw-body': 'e1c1ff9152ec1f5cf1ef1c2b853d6723e93ba13e4e9f1f15f9c6b2026a39a1cb',
    'on-finished': '8e16bae14ec63bac9cdbb50572a7b53061fee914712f5e803ff03c44e8845276',
}

VERIFIED_RICH_ROOT = EVIDENCE / 'rich-deps-v2'
VERIFIED_RICH_MAP = EVIDENCE / 'offline-install2-rich-first1/rich-installed-files.json'
VERIFIED_RICH_MAP_SHA256 = '4d6559a4cc1c3d753fa9ba38ee58ea4b59a9bc99512cf848786afdbc76b453f1'


# An independent transport canary prevents a failed guard from contacting any external service.
# Only synthetic 127.0.0.1 ephemeral HTTP can be used. Focused pure-vendor controls
# use exact admitted sources; async controls bind the existing S02 tree read-only.
# No installation, observer preload or additional preguard capability.
FAILSAFE = r'''const n=require('net'),dns=require('dns'),c=n.Socket.prototype.connect,l=n.Server.prototype.listen,lookup=dns.lookup;
n.Socket.prototype.connect=function(...a){let o=a[0];if(Array.isArray(o))o=o[0];if(!o||o.host!=='127.0.0.1')throw Error('CANARY_UNGUARDED_TRANSPORT');return c.apply(this,a);};
n.Server.prototype.listen=function(...a){if(a[0]!==0||a[1]!=='127.0.0.1')throw Error('CANARY_UNGUARDED_LISTEN');return l.apply(this,a);};
// Forward only the actual native numeric-literal branch, which returns before the resolver.
dns.lookup=function(host,callback){if(arguments.length!==2||host!=='127.0.0.1'||typeof callback!=='function')throw Error('CANARY_UNGUARDED_dns');return lookup.call(dns,host,callback);};
for(const [m,names] of [['tls',['connect']],['https',['request','get']],['dgram',['createSocket']],['child_process',['spawn','exec','execFile','fork']],['dns',['resolve']]])for(const k of names)require(m)[k]=()=>{throw Error('CANARY_UNGUARDED_'+m);};'''

# Used by direct guard controls and the actual unchanged parent launcher with real inert HTTP.
OWNED_HTTP_FLOW = r'''const h=require('http');const server=h.createServer((q,r)=>{r.end(q.method==='HEAD'?'':'synthetic');});server.listen(0,'127.0.0.1',()=>{process.stdout.write('SYNTHETIC_HTTP_READY '+server.address().port+'\n');const port=server.address().port;let index=0;function next(){if(index===2)return server.close(()=>{process.stdout.write('SYNTHETIC_HTTP_CLOSED\n');OUTPUT});const q=h.request({host:'127.0.0.1',port,method:['GET','HEAD'][index++],agent:false},r=>{r.resume();r.on('end',next);});q.end();}next();});'''


class DomesticControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='synthetic-domestic-', dir=EVIDENCE)
        self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name).resolve(); self.index = 0
        self.spec = json.loads((ROOT / d.TOOLS / 'policies/domestic_http.json').read_text())
        self.roots = {}; self.maps = {}
        for group, meta in self.spec['dependency_roots'].items():
            base = self.root / ('deps-' + group); base.mkdir(); self.roots[group] = base
            packages = {'': {'dependencies': meta['direct_dependencies']}}
            for name, version in meta['direct_dependencies'].items():
                target = base / 'node_modules' / name; target.mkdir(parents=True)
                (target / 'package.json').write_text(json.dumps({'name': name, 'version': version, 'main': 'index.js'}))
                text = 'module.exports={synthetic:' + json.dumps(name) + '};'
                if name == 'mongoose':
                    text = 'function M(){};function C(){};module.exports={Mongoose:M,Connection:C};'
                (target / 'index.js').write_text(text)
                packages['node_modules/' + name] = {'version': version, 'resolved': 'https://registry.npmjs.org/' + name + '/-/synthetic.tgz', 'integrity': 'sha512-synthetic'}
            meta['packages'] = len(packages) - 1
            (base / 'package.json').write_text(json.dumps({'dependencies': meta['direct_dependencies']}))
            (base / 'package-lock.json').write_text(json.dumps({'packages': packages}))
            for name, key in [('package.json', 'manifest_sha256'), ('package-lock.json', 'lock_sha256')]:
                target = self.root / meta['manifest_dir'] / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(base / name, target); meta[key] = d.sha(target)
            self.reindex(group)
        for entry in self.spec['variants'].values():
            for name in [*entry['sources'], *entry['exports']]:
                target = self.root / name; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('{}' if name.endswith('.json') else 'throw Error("ORIGINAL_SOURCE_MUST_NOT_EXECUTE");')
            for name in entry['static_inputs']:
                if name in RICH_SYNTHETIC_METADATA:
                    continue  # These exact two repo files already contain the fake Rich lock inputs.
                target = self.root / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / name, target)
        for name, key in RICH_SYNTHETIC_METADATA.items():
            repo_file = self.root / name
            fake_file = self.roots['rich'] / Path(name).name
            self.assertEqual(repo_file.read_bytes(), fake_file.read_bytes())
            self.assertEqual(d.sha(repo_file), self.spec['dependency_roots']['rich'][key])
        target = self.root / d.TOOLS / 'guards/domestic_http.cjs'; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / d.TOOLS / 'guards/domestic_http.cjs', target)
        for name in ['replay_domestic_http.py', 'test_replay_domestic_http.py', 'replay_delivery.py', 'replay_towns.py']:
            shutil.copyfile(ROOT / d.TOOLS / name, self.root / d.TOOLS / name)
        (self.root / d.EVIDENCE).mkdir(parents=True)
        self.addCleanup(self.retain)

    def reindex(self, group):
        base = self.roots[group]; files = {str(p.relative_to(base)): d.sha(p) for p in sorted((base / 'node_modules').rglob('*')) if p.is_file()}
        path = self.root / (group + '-files.json'); path.write_text(json.dumps({'regular_files': files, 'symlinks': {}})); self.maps[group] = path

    def bind_pinned_etag_source(self):
        # Read-only admitted source; copy only this file into the existing fake S02 inventory.
        self.assertEqual(d.sha(d.regular(PINNED_ETAG_MAP)), PINNED_ETAG_MAP_SHA256)
        installed = d.load(PINNED_ETAG_MAP)
        self.assertEqual(installed['regular_files']['node_modules/etag/index.js'], PINNED_ETAG_SOURCE_SHA256)
        source = d.regular(PINNED_ETAG_SOURCE).read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(), PINNED_ETAG_SOURCE_SHA256)
        target = self.roots['s02'] / 'node_modules/etag/index.js'
        self.assertFalse(target.exists())
        target.parent.mkdir()
        target.write_bytes(source)
        self.assertEqual(target.read_bytes(), source)
        self.pinned_etag_binding = {'source': str(PINNED_ETAG_SOURCE), 'source_sha256': PINNED_ETAG_SOURCE_SHA256, 'admitted_map_sha256': PINNED_ETAG_MAP_SHA256, 'copied_path': str(target), 'copied_sha256': d.sha(target), 'copied_vendor_files': 1, 'package_metadata_or_lock_copied': False}
        self.reindex('s02')
        return PINNED_ETAG_SOURCE_SHA256

    def bind_verified_s02_readonly(self):
        # Only synthetic repo manifests are copied; the existing full tree/map stay read-only.
        self.assertEqual(d.sha(d.regular(VERIFIED_S02_MAP)), PINNED_ETAG_MAP_SHA256)
        meta = deepcopy(d.load(ROOT / d.TOOLS / 'policies/domestic_http.json')['dependency_roots']['s02'])
        installed = d.load(VERIFIED_S02_MAP)
        self.assertEqual(len(installed['regular_files']), 4470)
        for package, digest in VERIFIED_ASYNC_PARENTS.items():
            relative = 'node_modules/' + package + '/index.js'
            self.assertEqual(installed['regular_files'][relative], digest)
            self.assertEqual(d.sha(d.regular(VERIFIED_S02_ROOT / relative)), digest)
        for name, key in [('package.json', 'manifest_sha256'), ('package-lock.json', 'lock_sha256')]:
            source = d.regular(VERIFIED_S02_ROOT / name).read_bytes()
            self.assertEqual(hashlib.sha256(source).hexdigest(), meta[key])
            target = self.root / meta['manifest_dir'] / name; target.write_bytes(source)
            self.assertEqual(d.sha(target), meta[key])
        self.spec['dependency_roots']['s02'] = meta
        self.roots['s02'] = VERIFIED_S02_ROOT; self.maps['s02'] = VERIFIED_S02_MAP
        self.verified_s02_binding = {'root': str(VERIFIED_S02_ROOT), 'map': str(VERIFIED_S02_MAP), 'map_sha256': PINNED_ETAG_MAP_SHA256, 'regular_files': 4470, 'dependency_tree_copied_or_modified': False, 'synthetic_manifest_copies': 2, 'native_context_observer': False}
        return VERIFIED_S02_ROOT

    def bind_verified_rich_readonly(self):
        # Only synthetic repo manifests are copied; the existing full tree/map stay read-only.
        self.assertEqual(d.sha(d.regular(VERIFIED_RICH_MAP)), VERIFIED_RICH_MAP_SHA256)
        meta = deepcopy(d.load(ROOT / d.TOOLS / 'policies/domestic_http.json')['dependency_roots']['rich'])
        installed = d.load(VERIFIED_RICH_MAP)
        self.assertEqual(len(installed['regular_files']), 5112)
        for package, digest in VERIFIED_ASYNC_PARENTS.items():
            relative = 'node_modules/' + package + '/index.js'
            self.assertEqual(installed['regular_files'][relative], digest)
            self.assertEqual(d.sha(d.regular(VERIFIED_RICH_ROOT / relative)), digest)
        for name, key in [('package.json', 'manifest_sha256'), ('package-lock.json', 'lock_sha256')]:
            source = d.regular(VERIFIED_RICH_ROOT / name).read_bytes()
            self.assertEqual(hashlib.sha256(source).hexdigest(), meta[key])
            target = self.root / meta['manifest_dir'] / name; target.write_bytes(source)
            self.assertEqual(d.sha(target), meta[key])
        self.spec['dependency_roots']['rich'] = meta
        self.roots['rich'] = VERIFIED_RICH_ROOT; self.maps['rich'] = VERIFIED_RICH_MAP
        self.verified_rich_binding = {'root': str(VERIFIED_RICH_ROOT), 'map': str(VERIFIED_RICH_MAP), 'map_sha256': VERIFIED_RICH_MAP_SHA256, 'regular_files': 5112, 'dependency_tree_copied_or_modified': False, 'synthetic_manifest_copies': 2, 'native_context_observer': False}
        return VERIFIED_RICH_ROOT

    def assert_async_parent_compiled(self, receipt, base, package):
        self.assertIn({'filename': str(base / 'node_modules' / package / 'index.js'), 'sha256': VERIFIED_ASYNC_PARENTS[package]}, receipt['cjs_compiles'])

    def retain(self):
        target = EVIDENCE / 'synthetic-evidence' / self.root.name; target.mkdir(parents=True, exist_ok=True)
        (target / 'control.json').write_text(json.dumps({'test': self.id(), 'original_modules_executed': False, 'original_modules_scope': 'legacy exports/handlers/models; pure vendor source is separately reported', 'pinned_pure_vendor_binding': getattr(self, 'pinned_etag_binding', None), 'verified_s02_binding': getattr(self, 'verified_s02_binding', None), 'verified_rich_binding': getattr(self, 'verified_rich_binding', None), 'verified_models_binding': getattr(self, 'verified_models_binding', None), 'status': 'see unittest result'}))
        runs = list((self.root / d.EVIDENCE).glob('run*'))
        for name in ('build11-kma-first-diagnostic1', 'build12-kma-first-diagnostic1'):
            diagnostic = self.root / d.EVIDENCE / name
            if diagnostic.is_dir():
                runs.append(diagnostic)
        for run in runs:
            shutil.copytree(run, target / run.name)

    def prepared(self, code='', variant='kma'):
        self.index += 1; spec = deepcopy(self.spec)
        for entry in spec['variants'].values():
            for mapping in ('sources', 'exports', 'static_inputs'):
                entry[mapping] = {p: d.sha(self.root / p) for p in entry[mapping]}
        entry = spec['variants'][variant]; (self.root / entry['driver']).write_text(code)
        entry['exports'][entry['driver']] = d.sha(self.root / entry['driver'])
        sp = self.root / d.TOOLS / 'policies/domestic_http.json'; sp.parent.mkdir(parents=True, exist_ok=True); sp.write_text(json.dumps(spec, indent=2) + '\n')
        groups = entry['dependency_groups']; roots = {g: self.roots[g] for g in groups}; maps = {g: self.maps[g] for g in groups}
        deps = d.dependencies(self.root, roots, maps, spec, variant)
        out = self.root / d.EVIDENCE / ('run' + str(self.index))
        paths = ['replay_domestic_http.py', 'test_replay_domestic_http.py', 'guards/domestic_http.cjs', 'policies/domestic_http.json', 'replay_delivery.py', 'replay_towns.py']
        tools = {d.TOOLS + name: d.sha(self.root / d.TOOLS / name) for name in paths}
        policy = {'schema': 1, 'profile': d.PROFILE, 'variant': variant, 'root': str(self.root), 'revision': 'c' * 40, 'dependency_roots': deps, 'sources': entry['sources'], 'exports': entry['exports'], 'output': str(out / entry['record_name']), 'tools': tools, 'guard_sha256': tools[d.TOOLS + 'guards/domestic_http.cjs'], 'spec_sha256': d.sha(sp), 'node_sha256': d.sha(NODE)}
        return self.root, NODE, out, policy, spec

    def run_code(self, code, expected=None, variant='kma', deadline=3, change=None, envextra=None, out_name=None):
        root, node, out, policy, spec = self.prepared(code, variant)
        if out_name is not None:
            self.assertIn(out_name, ('build11-kma-first-diagnostic1', 'build12-kma-first-diagnostic1'))
            out = out.parent / out_name; policy['output'] = str(out / Path(policy['output']).name)
        out.mkdir(); (out / 'harness').mkdir()
        if change:
            change(policy, spec)
        pp = out / 'policy.json'; pp.write_text(json.dumps(policy, sort_keys=True)); failsafe = out / 'failsafe.cjs'; failsafe.write_text(FAILSAFE)
        primary = 'rich' if variant == 'rich' else 's02'
        env = {'PATH': os.defpath, 'LANG': 'C', 'TZ': 'UTC', 'NODE_ENV': 'production', 'TW_REPO': str(root), 'TW_REVISION': policy['revision'], 'NODE_PATH': str(self.roots[primary] / 'node_modules'), 'TW_ORACLE_POLICY': str(pp), 'TW_SMOKE_OUTPUT_DIR': str(out / 'harness')}
        if envextra:
            env.update(envextra)
        command = [str(node), '--require', str(failsafe), '--require', str(root / d.TOOLS / 'guards/domestic_http.cjs'), str(root / spec['variants'][variant]['driver']), str(root), policy['output']]
        info, stdout = d.child(command, env, out, deadline); (out / 'control-result.json').write_text(json.dumps(info, indent=2))
        text = stdout.decode(errors='replace') + (out / 'stderr.log').read_text()
        self.assertTrue(info['process_reaped']); self.assertNotIn('CANARY_UNGUARDED', text); self.assertNotIn('ORIGINAL_SOURCE_MUST_NOT_EXECUTE', text)
        if expected:
            self.assertNotEqual(info['exit_code'], 0); self.assertIn(expected, info['failure'] or text)
        else:
            self.assertEqual(info['exit_code'], 0, text)
        return info, out, stdout

    @staticmethod
    def output(code=''):
        return code + ';require("fs").writeFileSync(process.argv[3],require("zlib").gzipSync(Buffer.from("{}")));'

    def synthetic_doc(self, variant, policy, spec):
        doc = json.loads(gzip.decompress((ROOT / 'server2/tests' / FIXTURES[variant]).read_bytes()))
        entry = spec['variants'][variant]; expected = {**policy['sources'], **policy['exports']}
        doc['source']['files'] = {p: expected[p] for p in entry['record_source_paths']}
        for name in RICH_SYNTHETIC_METADATA:
            if name in entry['static_inputs']:
                doc['source']['static_inputs'][name] = entry['static_inputs'][name]
        return doc

    def assert_parent_cjs_rejections(self, prepared):
        root, _, _, policy, spec = prepared
        entry = spec['variants'][policy['variant']]
        primary = 'rich' if policy['variant'] == 'rich' else 's02'
        package = policy['dependency_roots'][primary]
        valid = [
            {'filename': str(root / entry['driver']), 'sha256': policy['exports'][entry['driver']]},
            {'filename': str(Path(package['path']) / 'node_modules/async/index.js'), 'sha256': package['files']['node_modules/async/index.js']},
        ]
        self.assertEqual(d.validate_cjs_audit(valid, root, policy, spec), valid)
        self.assertEqual(d.validate_cjs_audit(valid + [dict(valid[0])], root, policy, spec), valid + [dict(valid[0])])
        cases = [
            (None, 'row count'),
            ('malformed', 'row count'),
            ([], 'row count'),
            ([None], 'row keys'),
            (valid[1:], 'selected entry missing'),
            ([{**valid[0], 'filename': str(root / 'unlisted.js')}], 'audit filename'),
            ([{**valid[0], 'filename': valid[0]['filename'].replace('/server/', '/server/./', 1)}], 'audit filename'),
            ([{'filename': str(Path(package['path']) / 'node_modules/async/package.json'), 'sha256': package['files']['node_modules/async/package.json']}], 'audit filename'),
            ([{**valid[0], 'sha256': '0'*64}], 'digest identity'),
            ([{**valid[0], 'sha256': 'G'*64}], 'digest format'),
            ([{**valid[0], 'sha256': 'a'*63}], 'digest format'),
            ([{**valid[0], 'extra': True}], 'row keys'),
            ([{'filename': valid[0]['filename']}], 'row keys'),
            ([dict(valid[0])]*4097, 'row count'),
            ([{**valid[0], 'filename': str(root) + '/' + '가'*400000 + '.js'}], 'byte bound'),
        ]
        for rows, reason in cases:
            with self.subTest(parent_cjs_audit=reason):
                with self.assertRaisesRegex(ValueError, reason):
                    d.validate_cjs_audit(rows, root, policy, spec)
        conflicting = deepcopy(policy)
        conflicting['sources'][entry['driver']] = '0'*64
        with self.assertRaisesRegex(ValueError, 'conflicting expected identity'):
            d.validate_cjs_audit(valid, root, conflicting, spec)

    def test_all_five_complete_validator_shapes(self):
        for variant in self.spec['variants']:
            root, node, out, policy, spec = self.prepared('', variant); out.mkdir()
            self.assert_parent_cjs_rejections((root, node, out, policy, spec))
            doc = self.synthetic_doc(variant, policy, spec); target = Path(policy['output']); target.write_bytes(gzip.compress(json.dumps(doc).encode()))
            self.assertEqual(d.validate_record(target, policy, spec)[0], doc)
            rows = doc[spec['variants'][variant]['row_field']]; rows.pop(); target.write_bytes(gzip.compress(json.dumps(doc).encode()))
            with self.assertRaisesRegex(ValueError, 'ordered corpus'):
                d.validate_record(target, policy, spec)

    def assert_cjs_audit(self, receipt, policy, spec, variant):
        self.assertIn('cjs_compiles', receipt)
        rows = receipt['cjs_compiles']; self.assertIsInstance(rows, list)
        self.assertLessEqual(len(rows), 4096)
        self.assertLessEqual(len(json.dumps(rows, separators=(',', ':')).encode()), 1024*1024)
        self.assertTrue(all(set(row) == {'filename', 'sha256'} for row in rows))
        entry = spec['variants'][variant]
        primary = 'rich' if variant == 'rich' else 's02'
        package = policy['dependency_roots'][primary]
        expected = [
            {'filename': str(self.root / entry['driver']), 'sha256': policy['exports'][entry['driver']]},
            {'filename': str(Path(package['path']) / 'node_modules/async/index.js'), 'sha256': package['files']['node_modules/async/index.js']},
        ]
        self.assertEqual(rows, expected)

    def test_full_five_synthetic_outputs_through_launcher(self):
        for variant in self.spec['variants']:
            _, _, _, policy, spec = self.prepared('', variant)
            doc = self.synthetic_doc(variant, policy, spec)
            payload = __import__('base64').b64encode(gzip.compress(json.dumps(doc).encode())).decode()
            code = 'if(require("async").synthetic!=="async")throw Error("fake async");require("async/package.json");require("async");'
            output = 'require("fs").writeFileSync(process.argv[3],Buffer.from(' + json.dumps(payload) + ',"base64"));'
            code += OWNED_HTTP_FLOW.replace('OUTPUT', output)
            prepared = self.prepared(code, variant)
            result = d.execute(prepared)
            self.assertEqual(result['status'], 'RECORDED_NOT_COMPARED', result)
            self.assertEqual(result['guard']['owned_ports_remaining'], 0)
            self.assertEqual(result['guard']['owned_sockets_remaining'], 0)
            self.assertEqual(result['guard']['transport_calls'], 2)
            stdout = (prepared[2] / 'stdout.log').read_bytes()
            self.assertIn(b'SYNTHETIC_HTTP_READY ', stdout)
            self.assertIn(b'SYNTHETIC_HTTP_CLOSED\n', stdout)
            self.assertTrue(result['input_checks_after']['verified'])
            self.assertTrue(result['dependencies_verified_after'])
            self.assert_cjs_audit(result['guard'], prepared[3], prepared[4], variant)

    def test_positive_owned_ephemeral_get_head_close(self):
        _, _, stdout = self.run_code(OWNED_HTTP_FLOW.replace('OUTPUT', self.output()))
        self.assertIn(b'SYNTHETIC_HTTP_READY ', stdout)
        self.assertIn(b'SYNTHETIC_HTTP_CLOSED\n', stdout)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['transport_calls'], 2)
        self.assertEqual(receipt['owned_ports_remaining'], 0)
        self.assertEqual(receipt['owned_sockets_remaining'], 0)

    def test_positive_source_reads_harness_mkdir_and_same_parent_package(self):
        root, node, out, policy, spec = self.prepared(); paths = list(policy['sources'])
        code = 'const fs=require("fs"),p=require("path");fs.mkdirSync(process.env.TW_SMOKE_OUTPUT_DIR,{recursive:true});for(const f of ' + json.dumps(paths) + ')fs.readFileSync(p.join(process.env.TW_REPO,f));if(require("async").synthetic!=="async"||require("async/package.json").version!=="2.6.2")throw Error("alias");'
        self.run_code(self.output(code))

    def test_private_reads_writes_metadata_and_extra_helpers_are_audited_if_caught(self):
        probes = [('require("fs").readFileSync(process.argv[2]+"/server/config/config.js")', 'private read'), ('require("fs").writeFileSync(process.argv[2]+"/server/locales/ko.json","bad")', 'output write'), ('require("fs").statSync(process.argv[2]+"/private-key")', 'private metadata')]
        for probe, reason in probes:
            self.run_code(self.output('try{' + probe + '}catch(e){}'), reason)
        # A missing module can fail before the guard. Bind no permission: create an actual unlisted canary.
        extra = self.root / 'extra-helper.js'; extra.write_text('throw Error("ORIGINAL_SOURCE_MUST_NOT_EXECUTE");')
        entry = self.spec['variants']['kma']
        for mapping in ('sources', 'exports', 'static_inputs'):
            self.assertNotIn('extra-helper.js', entry[mapping])
        self.assertNotIn('extra-helper.js', entry['metadata_paths'])
        violation = 'private metadata ' + str(extra)
        code = 'let caught=false;try{require(' + json.dumps(str(extra)) + ');}catch(e){if(e.message!==' + json.dumps('ORACLE_DENIED ' + violation) + ')throw e;caught=true;process.stdout.write(e.message+String.fromCharCode(10));}if(!caught)throw Error("unlisted helper was not denied");'
        _, _, stdout = self.run_code(self.output(code), 'ORACLE_DENIED ' + violation)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['status'], 'DENIED')
        self.assertEqual(receipt['violations'], [violation])
        for key in ('reads', 'modules'):
            self.assertNotIn(str(extra), receipt[key])
        self.assertNotIn(str(extra), [row['filename'] for row in receipt['cjs_compiles']])
        self.assertEqual(receipt['transport_calls'], 0)

    def test_unowned_fixed_nonlocal_and_wrong_http_methods_are_denied(self):
        for options in ["{host:'127.0.0.1',port:1,method:'GET',agent:false}", "{host:'localhost',port:1,agent:false}", "{host:'::1',port:1,agent:false}", "{host:'example.invalid',port:80,agent:false}", "{host:'127.0.0.1',port:1,method:'POST',agent:false}"]:
            self.run_code('require("http").request(' + options + ')', 'HTTP unowned')
        for args in ["80,'127.0.0.1'", "0,'0.0.0.0'", "0,'localhost'", "0,'127.0.0.2'", "0,'::1'", "0,'127.0.0.1',1", "{port:0,host:'127.0.0.1'}"]:
            self.run_code('require("http").createServer().listen(' + args + ',()=>{})', 'listen exact')
        self.run_code('new (require("net").Server)().listen(0,"127.0.0.1",()=>{})', 'listen exact')
        self.run_code('require("http").createServer().listen(0,"127.0.0.1",null)', 'listen exact')

    def test_tls_udp_dns_child_worker_background_are_denied(self):
        for code, reason in [('require("tls").connect(443,"example.invalid")', 'tls.connect'), ('require("dgram").createSocket("udp4")', 'dgram.createSocket'), ('require("dns").lookup("example.invalid",()=>{})', 'ORACLE_DENIED dns lookup outside owned listen'), ('require("child_process").spawn("true")', 'child_process.spawn'), ('new (require("worker_threads").Worker)("0",{eval:true})', 'worker'), ('setInterval(()=>{},1000)', 'background interval')]:
            self.run_code(code, reason)

        # Numeric spelling alone never permits public DNS outside the synchronous owned listen.
        probes = [
            ('process.stdout.write("SYNTHETIC_DNS_BEFORE\\n");require("dns").lookup("127.0.0.1",()=>{});', 'SYNTHETIC_DNS_BEFORE'),
            ('const s=require("http").createServer();s.listen(0,"127.0.0.1",()=>{});process.stdout.write("SYNTHETIC_LISTEN_RETURNED\\n");require("dns").lookup("127.0.0.1",()=>{});', 'SYNTHETIC_LISTEN_RETURNED'),
            ('const s=require("http").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write("SYNTHETIC_DNS_CALLBACK\\n");try{require("dns").lookup("127.0.0.1",()=>{});}catch(e){}s.close(()=>{process.stdout.write("SYNTHETIC_DNS_CALLBACK_CLOSED\\n");OUTPUT});});', 'SYNTHETIC_DNS_CALLBACK_CLOSED'),
            ('const s=require("http").createServer();s.listen(0,"127.0.0.1",()=>s.close(()=>{process.stdout.write("SYNTHETIC_DNS_CLOSED\\n");require("dns").lookup("127.0.0.1",()=>{});}));', 'SYNTHETIC_DNS_CLOSED'),
        ]
        for code, marker in probes:
            _, _, stdout = self.run_code(code.replace('OUTPUT', self.output()), 'dns lookup outside owned listen')
            self.assertIn(marker.encode(), stdout)
        for code, reason in [('require("dns").resolve4("example.invalid",()=>{})', 'ORACLE_DENIED dns resolve4'), ('require("dns").lookupService("127.0.0.1",1,()=>{})', 'ORACLE_DENIED dns lookupService'), ('require("dns").promises.lookup("127.0.0.1")', 'ORACLE_DENIED dns lookup'), ('require("dns").Resolver()', 'ORACLE_DENIED dns Resolver'), ('require("dns").promises.Resolver()', 'ORACLE_DENIED dns Resolver')]:
            self.run_code(code, reason)
        # Forward malformed native listen->lookup calls inside the real slot; do not fabricate binding.
        for forwarded in ['checked("localhost",callback)', 'checked("127.0.0.2",callback)', 'checked(new String(host),callback)', 'checked(host)', 'checked(host,null)', 'checked(host,{},callback)', 'checked(host,callback,true)']:
            code = 'const dns=require("dns"),checked=dns.lookup;dns.lookup=(host,callback)=>' + forwarded + ';require("http").createServer().listen(0,"127.0.0.1",()=>{});'
            self.run_code(code, 'dns lookup shape')
        reused = 'const dns=require("dns"),checked=dns.lookup;dns.lookup=(host,callback)=>{const result=checked(host,callback);checked(host,callback);return result;};require("http").createServer().listen(0,"127.0.0.1",()=>{});'
        self.run_code(reused, 'dns lookup consumed')
        restored = 'const dns=require("dns"),checked=dns.lookup;dns.lookup=(host,callback)=>checked("localhost",callback);try{require("http").createServer().listen(0,"127.0.0.1",()=>{});}catch(e){process.stdout.write("SYNTHETIC_LOOKUP_CAUGHT\\n");}dns.lookup=checked;checked("127.0.0.1",()=>{});'
        _, _, stdout = self.run_code(restored, 'dns lookup outside owned listen')
        self.assertIn(b'SYNTHETIC_LOOKUP_CAUGHT\n', stdout)

    def test_vm_filename_and_code_binding(self):
        # Running code cannot reuse its already consumed CJS slot, even with its own exact body.
        dynamic = 'const fs=require("fs"),vm=require("vm");require("async");require("async/package.json");require("async");const body=fs.readFileSync(__filename,"utf8");vm.compileFunction(body,["exports","require","module","__filename","__dirname"],{filename:__filename,importModuleDynamically(){}});'
        self.run_code(self.output(dynamic), 'VM compileFunction dynamic')
        # Inert code forwards a fake package's real CJS request with one deliberately wrong field.
        corruptions = [
            ('body+"\\n"', 'params', 'options', 'CJS compileFunction body'),
            ('body', 'params.slice(1)', 'options', 'CJS compileFunction parameters'),
            ('body', 'params', '{...options,filename:__filename}', 'CJS compileFunction filename'),
            ('body', 'params', '{...options,extra:true}', 'CJS compileFunction options'),
            ('body', 'params', '{filename:options.filename,importModuleDynamically:null}', 'CJS compileFunction options'),
        ]
        for body, params, options, reason in corruptions:
            code = 'const vm=require("vm"),checked=vm.compileFunction;vm.compileFunction=(body,params,options)=>checked(' + body + ',' + params + ',' + options + ');require("async");'
            self.run_code(self.output(code), reason)
        restore_after_error = 'const fs=require("fs"),vm=require("vm"),checked=vm.compileFunction;vm.compileFunction=(body,params,options)=>checked(body+"\\n",params,options);try{require("async");}catch(e){}vm.compileFunction=checked;checked(fs.readFileSync(__filename,"utf8"),["exports","require","module","__filename","__dirname"],{filename:__filename,importModuleDynamically(){}});'
        self.run_code(self.output(restore_after_error), 'VM compileFunction dynamic')
        extra_arg = 'const vm=require("vm"),checked=vm.compileFunction;vm.compileFunction=(body,params,options)=>checked(body,params,options,true);require("async");'
        self.run_code(self.output(extra_arg), 'CJS compileFunction arguments')
        self.run_code('new (require("vm").Script)("1+1")', 'VM Script')
        self.run_code('require("vm").runInThisContext("1+1")', 'VM runInThisContext')
        self.run_code('require("vm").runInNewContext("1+1",{},{filename:"/unlisted.js"})', 'VM filename')
        self.run_code('require("vm").runInNewContext("1+1",{})', 'VM code identity')
        # Positive: exact inert full wrapper, bound under a selected source filename.
        source = self.root / 'server/lib/kmaForecastRegions.js'
        source.write_text('module.exports={synthetic:true};')
        spec = self.spec['variants']['kma']; code = '(function(require,module,exports,__filename,__dirname){' + source.read_text() + '\n})'
        spec['vm_entries'].append({'filename': 'server/lib/kmaForecastRegions.js', 'sha256': hashlib.sha256(code.encode()).hexdigest()})
        self.run_code(self.output('require("vm").runInNewContext(' + json.dumps(code) + ',{},{filename:process.argv[2]+"/server/lib/kmaForecastRegions.js"})'))

    def test_native_real_db_and_wrong_parent_alias_denied(self):
        self.run_code('require("module").createRequire(process.argv[2]+"/wrong-parent.js")("async/package.json")', 'ORACLE_DENIED direct alias wrong parent')
        base = self.roots['s02'] / 'node_modules/async'; (base / 'blocked.node').write_text('NOT_NATIVE'); (base / 'index.js').write_text('require("./blocked.node");'); self.reindex('s02')
        self.run_code('require("async")', 'ORACLE_DENIED native module')
        self.run_code('require("mongoose").connect("mongodb://127.0.0.1")', 'ORACLE_DENIED mongoose connect', variant='core')
        # Unselected-root resolution is denied by metadata before module-path checks.
        foreign = self.roots['models'] / 'node_modules/mongoose/index.js'
        (base / 'index.js').write_text('module.exports=require(' + json.dumps(str(foreign.parent)) + ');'); self.reindex('s02')
        # With both roots selected, resolution is permitted but the dependency still cannot cross roots.
        for variant, violation in [('kma', 'private metadata ' + str(foreign)), ('core', 'cross-root dependency')]:
            _, _, stdout = self.run_code('require("async")', 'ORACLE_DENIED ' + violation, variant=variant)
            receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
            self.assertEqual(receipt['status'], 'DENIED')
            self.assertEqual(receipt['violations'], [violation])
            for key in ('reads', 'modules'):
                self.assertNotIn(str(foreign), receipt[key])
            self.assertNotIn(str(foreign), [row['filename'] for row in receipt['cjs_compiles']])
            self.assertEqual(receipt['transport_calls'], 0)
            self.assertEqual(receipt['owned_ports_remaining'], 0)
            self.assertEqual(receipt['owned_sockets_remaining'], 0)

    def test_metadata_only_model_and_cold_read_transcript(self):
        relative = 'server/models/modelKmaForecastNarrative.js'
        path = self.root / relative; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('throw Error("REAL_MODEL_MUST_NOT_EXECUTE");')
        self.assertIn(relative, self.spec['variants']['kma']['metadata_paths'])
        code = 'const fs=require("fs");if(!fs.statSync(process.argv[2]+"/' + relative + '").isFile())throw Error("metadata");const calls=[];const q={sort(){return q;},limit(){return q;},lean(){return q;},exec(cb){calls.push("unknown_model:modelKmaForecastNarrative");cb(null,[]);}};q.sort({}).limit(1).lean().exec((e,v)=>{if(v.length||calls.length!==1)throw Error("cold transcript lost");});'
        self.run_code(self.output(code))
        self.run_code('require("fs").readFileSync(process.argv[2]+"/' + relative + '")', 'private read')
        self.run_code('require(process.argv[2]+"/' + relative + '")', 'module path')

    def test_preflight_node_source_and_installed_file_identity(self):
        root, node, out, policy, spec = self.prepared()
        groups = spec['variants']['kma']['dependency_groups']
        args = dict(root=root, node=node, roots={g:self.roots[g] for g in groups}, manifests={g:self.maps[g] for g in groups}, out=out, variant='kma')
        with patch.object(d.subprocess, 'check_output', return_value=b'c'*40+b'\n'):
            self.assertEqual(d.prepare(**args)[3]['node_sha256'], d.sha(NODE))
        fake = self.root / 'not-node'; fake.write_text('synthetic')
        with self.assertRaisesRegex(ValueError, 'official Node'):
            d.prepare(**{**args, 'node':fake})
        path = self.root / next(iter(policy['sources'])); original = path.read_bytes(); path.write_bytes(original+b'changed')
        with self.assertRaisesRegex(ValueError, 'selected source'):
            d.prepare(**args)
        path.write_bytes(original)
        package = self.roots['s02'] / 'node_modules/async/index.js'; package.write_text('changed')
        with self.assertRaisesRegex(ValueError, 'installed identity'):
            d.dependencies(root, args['roots'], args['manifests'], spec, 'kma')

    def test_unknown_environment_and_wrong_output_existing_are_denied(self):
        self.run_code(self.output(), 'fixed environment', envextra={'UNSELECTED_TOKEN': 'synthetic'})
        self.run_code('require("fs").writeFileSync(process.argv[3]+".extra","x")', 'output write')
        self.run_code(self.output(self.output()), 'output write')
        self.run_code('require("fs").mkdirSync(process.env.TW_SMOKE_OUTPUT_DIR+"/child",{recursive:true})', 'mkdir')

    def test_compressed_inflated_duplicate_body_clock_and_sections_reject(self):
        root, node, out, policy, spec = self.prepared('', 'rich'); out.mkdir(); entry = spec['variants']['rich']; target = Path(policy['output'])
        target.write_bytes(b'x' * (entry['gzip_limit_bytes'] + 1))
        with self.assertRaisesRegex(ValueError, 'compressed'):
            d.decode_record(target, entry)
        target.write_bytes(gzip.compress(b' ' * (entry['inflated_limit_bytes'] + 1)))
        with self.assertRaisesRegex(ValueError, 'inflated'):
            d.decode_record(target, entry)
        target.write_bytes(gzip.compress(b'{"schema":1,"schema":1}'))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            d.decode_record(target, entry)
        for mutate, reason in [(lambda x: x.update(clock='wrong'), 'fixed metadata'), (lambda x: x['raw'].pop(), 'ordered raw'), (lambda x: x['rich_raw'].pop(), 'ordered rich_raw'), (lambda x: x['rich_inputs'].pop('air'), 'rich input'), (lambda x: x['requests'][0].update(body_sha256='0' * 64), 'body identity'), (lambda x: x['source']['files'].update({'extra': '0' * 64}), 'source map')]:
            doc = self.synthetic_doc('rich', policy, spec); mutate(doc); target.write_bytes(gzip.compress(json.dumps(doc).encode()))
            with self.assertRaisesRegex(ValueError, reason):
                d.validate_record(target, policy, spec)

    def test_deadline_stream_limit_and_listener_reap(self):
        info, _, stdout = self.run_code('process.stdout.write("SYNTHETIC_CJS_READY\\n");while(true){}', 'child deadline', deadline=0.5)
        self.assertIn(b'SYNTHETIC_CJS_READY\n', stdout)
        with self.assertRaises(ProcessLookupError):
            os.kill(info['pid'], 0)
        info, _, stdout = self.run_code('process.stdout.write("SYNTHETIC_STREAM_READY\\n");process.stdout.write("x".repeat(3*1024*1024));', 'child output limit')
        self.assertIn(b'SYNTHETIC_STREAM_READY\n', stdout)
        with self.assertRaises(ProcessLookupError):
            os.kill(info['pid'], 0)
        code = "const server=require('http').createServer((q,r)=>r.end());server.listen(0,'127.0.0.1',()=>process.stdout.write('SYNTHETIC_LISTENER_READY '+server.address().port+'\\n'));"
        info, out, stdout = self.run_code(code, 'child deadline', deadline=0.5)
        marker = next(line for line in stdout.decode().splitlines() if line.startswith('SYNTHETIC_LISTENER_READY '))
        port = int(marker.split()[1]); self.assertGreater(port, 0)
        with self.assertRaises(ProcessLookupError):
            os.kill(info['pid'], 0)
        (out / 'listener-retirement.json').write_text(json.dumps({'owned_port': port, 'owner_pid': info['pid'], 'process_reaped': info['process_reaped'], 'owner_pid_absent': True, 'transport_probe_performed': False, 'basis': 'Owned server owner process was killed/reaped and is absent; suite parent also inventories surviving owned children.'}))

    def test_parent_finally_verification_on_failure(self):
        prepared = self.prepared('throw Error("synthetic failure")'); root, node, out, policy, spec = prepared
        result = d.execute(prepared)
        self.assertEqual(result['status'], 'BLOCKED'); self.assertTrue(result['input_checks_after']['verified']); self.assertTrue(result['dependencies_verified_after']); self.assertTrue(result['process_reaped'])
        with patch.object(d, 'child', side_effect=lambda *a: ((root / next(iter(policy['sources']))).write_text('changed'), (_ for _ in ()).throw(ValueError('synthetic input mutation')))[1]):
            second = self.prepared(''); result = d.execute(second)
        self.assertEqual(result['status'], 'BLOCKED'); self.assertFalse(result['input_checks_after']['verified']); self.assertTrue(result['dependencies_verified_after'])
        negative = self.prepared('')
        _, _, _, policy, spec = negative
        doc = self.synthetic_doc('kma', policy, spec)
        package = policy['dependency_roots']['s02']
        missing_entry = [{'filename': str(Path(package['path']) / 'node_modules/async/index.js'), 'sha256': package['files']['node_modules/async/index.js']}]

        def audit_receipt_fixture(command, env, output, deadline):
            record = Path(policy['output']); record.write_bytes(gzip.compress(json.dumps(doc).encode()))
            d.validate_record(record, policy, spec)  # Prove the negative audit fixture is otherwise a valid full output.
            receipt = {'oracle_guard': 1, 'profile': d.PROFILE, 'variant': 'kma', 'status': 'RECORDED', 'violations': [], 'owned_ports_remaining': 0, 'owned_sockets_remaining': 0, 'output_sha256': d.sha(record), 'cjs_compiles': missing_entry}
            stdout = (json.dumps(receipt) + '\n').encode()
            (output / 'stdout.log').write_bytes(stdout); (output / 'stderr.log').write_bytes(b'')
            return {'exit_code': 0, 'failure': None, 'child_started': False, 'process_reaped': None, 'child_receipt_fixture_only': True}, stdout

        with patch.object(d, 'child', side_effect=audit_receipt_fixture):
            result = d.execute(negative)
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertIn('CJS selected entry missing', result['reason'])
        self.assertTrue(result['child_receipt_fixture_only']); self.assertFalse(result['child_started'])
        self.assertTrue(result['input_checks_after']['verified']); self.assertTrue(result['dependencies_verified_after'])



    def test_refusal_vm_filename_diagnostic(self):
        code = 'try{require("vm").runInNewContext("1+1",{},{filename:"/unlisted.js"});}catch(e){}'
        _, out, stdout = self.run_code(self.output(code), 'VM filename')
        rows = [json.loads(line[len('ORACLE_REFUSAL_V1 '):]) for line in (out / 'stderr.log').read_text().splitlines() if line.startswith('ORACLE_REFUSAL_V1 ')]
        self.assertEqual(len(rows), 1)
        row = rows[0]; self.assertEqual(row['schema'], 1); self.assertEqual(row['reason'], 'VM filename')
        self.assertEqual(row['context'], {'filename': '/unlisted.js', 'code_utf8_bytes': 3, 'code_sha256': hashlib.sha256(b'1+1').hexdigest()})
        self.assertEqual(row['transport_calls'], 0); self.assertEqual(row['vm_calls'], 0)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['violations'], ['VM filename']); self.assertEqual(receipt['status'], 'DENIED')
        self.assertLessEqual(len((out / 'stderr.log').read_bytes()), 65536)

    def test_refusal_caught_async_hooks_diagnostic_and_bound(self):
        for repeats in (1, 20):
            with self.subTest(repeats=repeats):
                code = 'for(let i=0;i<' + str(repeats) + ';i++){try{require("async_hooks");}catch(e){}}'
                _, out, stdout = self.run_code(self.output(code), 'builtin async_hooks')
                rows = [json.loads(line[len('ORACLE_REFUSAL_V1 '):]) for line in (out / 'stderr.log').read_text().splitlines() if line.startswith('ORACLE_REFUSAL_V1 ')]
                self.assertGreater(len(rows), 0); self.assertLessEqual(len(rows), 16)
                policy = json.loads((out / 'policy.json').read_text()); driver = self.spec['variants']['kma']['driver']
                for row in rows:
                    self.assertEqual(row['reason'], 'builtin async_hooks')
                    self.assertEqual(row['context'], {'request': 'async_hooks', 'parent': str(self.root / driver), 'parent_sha256': policy['exports'][driver]})
                    self.assertEqual(row['transport_calls'], 0)
                receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
                self.assertEqual(receipt['violations'].count('builtin async_hooks'), repeats)
                self.assertEqual(receipt['status'], 'DENIED')
                if repeats == 1:
                    self.assertEqual(len(rows), 1); self.assertEqual(receipt['violations'], ['builtin async_hooks'])
                else:
                    self.assertIn('refusal audit bound', receipt['violations'])
                self.assertLessEqual(len((out / 'stderr.log').read_bytes()), 65536)

    def test_first_request_diagnostic_bound_without_permission_widening(self):
        code = r'''const h=require('http'),vm=require('vm'),fs=require('fs');const s=h.createServer((q,r)=>r.end('synthetic'));s.listen(0,'127.0.0.1',()=>{const opts={host:'127.0.0.1',port:s.address().port,method:'GET',agent:false};const q=h.request(opts,r=>{r.resume();r.on('end',()=>{process.stdout.write('SYNTHETIC_FIRST_RESPONSE_END\n');let requestDenied=false,caseDenied=false,extra;try{extra=h.request(opts,()=>{});}catch(e){requestDenied=e.message==='ORACLE_DENIED diagnostic request limit';}if(extra){extra.on('error',()=>{});extra.destroy();}try{vm.runInNewContext('1+1',{},{filename:process.argv[2]+'/server/test/offline/rss-response-smoke.js'});}catch(e){caseDenied=e.message==='ORACLE_DENIED diagnostic case boundary';}s.close(()=>{if(!requestDenied||!caseDenied)throw Error('MISSING_EXACT_DIAGNOSTIC_BOUND');OUTPUT});});});q.end();});'''
        _, _, stdout = self.run_code(code.replace('OUTPUT', self.output()), 'diagnostic request limit', out_name='build11-kma-first-diagnostic1')
        self.assertIn(b'SYNTHETIC_FIRST_RESPONSE_END\n', stdout)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['violations'], ['diagnostic request limit', 'diagnostic case boundary'])
        self.assertEqual(receipt['transport_calls'], 1)
        self.assertEqual(receipt['owned_ports_remaining'], 0); self.assertEqual(receipt['owned_sockets_remaining'], 0)
        self.assertEqual(receipt['status'], 'DENIED')

    def test_native_buffer_returns_via_declared_node_virtual_vm(self):
        # Red-old: this exact test-local pair does not bypass the old physical filename gate.
        # Green-new: actual KMA policy contains it; method and intended success stay identical.
        entries = self.spec['variants']['kma']['vm_entries']
        if NODE_STRUCTURED_STACK_ENTRY not in entries:
            entries.append(dict(NODE_STRUCTURED_STACK_ENTRY))
        code = r"process.stdout.write('NATIVE_BUFFER_BEFORE\n');const a=new Buffer('synthetic','utf8'),b=new Buffer('second','utf8');if(a.toString()!=='synthetic'||b.toString()!=='second')throw Error('BUFFER_BYTES');process.stdout.write('NATIVE_BUFFER_RETURNED\n');"
        _, _, stdout = self.run_code(self.output(code))
        self.assertIn(b'NATIVE_BUFFER_BEFORE\n', stdout)
        self.assertIn(b'NATIVE_BUFFER_RETURNED\n', stdout)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['status'], 'RECORDED'); self.assertEqual(receipt['violations'], [])
        self.assertEqual([row for row in receipt['vm_calls'] if row['filename'] == 'structured-stack'], [NODE_STRUCTURED_STACK_ENTRY])

    def test_native_virtual_vm_exact_boundaries_and_policy(self):
        entries = self.spec['variants']['kma']['vm_entries']
        if NODE_STRUCTURED_STACK_ENTRY not in entries:
            entries.append(dict(NODE_STRUCTURED_STACK_ENTRY))
        prelude = 'const vm=require("vm"),body=' + json.dumps(NODE_STRUCTURED_STACK_CODE) + ',context={overrideStackTrace:new WeakMap()},options={filename:"structured-stack"};'
        # These direct VM controls verify permission, not an authenticated native caller.
        self.run_code(self.output(prelude + 'if(typeof vm.runInNewContext(body,context,options)!=="function")throw Error("VM_RESULT");'))
        cases = [
            ('vm.runInNewContext(body+"\\n",context,options);', 'VM native code identity'),
            ('vm.runInNewContext(body.replace("Infinity","Infinitx"),context,options);', 'VM native code identity'),
            ('vm.runInNewContext(body,context,{filename:"structured-stack-x"});', 'VM filename'),
            ('vm.runInNewContext(body,context,{filename:"/structured-stack"});', 'VM filename'),
            ('vm.runInNewContext(body,context,{...options,timeout:1000});', 'VM native options'),
            ('vm.runInNewContext(body,context,{...options,[Symbol("extra")]:true});', 'VM native options'),
            ('vm.runInNewContext(body,context,Object.create(options));', 'VM native options'),
            ('vm.runInNewContext(body,context,Object.defineProperty({},"filename",{get(){return "structured-stack";}}));', 'VM native options'),
            ('vm.runInNewContext(body,context,Object.assign([],{filename:"structured-stack"}));', 'VM native options'),
            ('vm.runInNewContext(body,{},options);', 'VM native context'),
            ('vm.runInNewContext(body,{...context,extra:true},options);', 'VM native context'),
            ('vm.runInNewContext(body,{...context,[Symbol("extra")]:true},options);', 'VM native context'),
            ('vm.runInNewContext(body,Object.create(context),options);', 'VM native context'),
            ('vm.runInNewContext(body,Object.defineProperty({},"overrideStackTrace",{get(){return new WeakMap();}}),options);', 'VM native context'),
            ('vm.runInNewContext(body,{overrideStackTrace:null},options);', 'VM native context'),
            ('vm.runInNewContext(body,{overrideStackTrace:{set:0}},options);', 'VM native context'),
            ('vm.runInNewContext(body,context,options,{});', 'VM native arguments'),
            ('vm.runInContext(body,vm.createContext(context),options);', 'VM native method'),
            ('vm.runInNewContext(new String(body),context,options);', 'VM code type'),
        ]
        for code, reason in cases:
            with self.subTest(reason=reason, code=code):
                self.run_code(self.output(prelude + code), 'ORACLE_DENIED ' + reason)
        self.spec['variants']['kma']['vm_entries'] = [row for row in entries if row != NODE_STRUCTURED_STACK_ENTRY]
        try:
            self.run_code(self.output("new Buffer('synthetic','utf8');"), 'ORACLE_DENIED VM code identity')
        finally:
            self.spec['variants']['kma']['vm_entries'] = entries
        # Selected profile success is now covered by four independent native Buffer tests.
        # Exact code/options/context/membership negatives above remain unchanged.

    def test_build12_first_request_diagnostic_bound(self):
        code = r'''const h=require('http'),vm=require('vm'),fs=require('fs');const s=h.createServer((q,r)=>r.end('synthetic'));s.listen(0,'127.0.0.1',()=>{const opts={host:'127.0.0.1',port:s.address().port,method:'GET',agent:false};const q=h.request(opts,r=>{r.resume();r.on('end',()=>{process.stdout.write('SYNTHETIC_FIRST_RESPONSE_END\n');let requestDenied=false,caseDenied=false,extra;try{extra=h.request(opts,()=>{});}catch(e){requestDenied=e.message==='ORACLE_DENIED diagnostic request limit';}if(extra){extra.on('error',()=>{});extra.destroy();}try{vm.runInNewContext('1+1',{},{filename:process.argv[2]+'/server/test/offline/rss-response-smoke.js'});}catch(e){caseDenied=e.message==='ORACLE_DENIED diagnostic case boundary';}s.close(()=>{if(!requestDenied||!caseDenied)throw Error('MISSING_EXACT_DIAGNOSTIC_BOUND');OUTPUT});});});q.end();});'''
        _, _, stdout = self.run_code(code.replace('OUTPUT', self.output()), 'diagnostic request limit', out_name='build12-kma-first-diagnostic1')
        self.assertIn(b'SYNTHETIC_FIRST_RESPONSE_END\n', stdout)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['violations'], ['diagnostic request limit', 'diagnostic case boundary'])
        self.assertEqual(receipt['transport_calls'], 1)
        self.assertEqual(receipt['owned_ports_remaining'], 0); self.assertEqual(receipt['owned_sockets_remaining'], 0)
        self.assertEqual(receipt['status'], 'DENIED')

    def test_stats_introspection_preserves_false_instanceof_without_io(self):
        code = r"const fs=require('fs'),d=Object.getOwnPropertyDescriptor(fs,'Stats');process.stdout.write('GUARDED_STATS_SHAPE '+JSON.stringify({enumerable:!!d&&d.enumerable,type:typeof fs.Stats,ownPrototype:Object.hasOwn(fs.Stats,'prototype'),prototypeType:typeof fs.Stats.prototype})+'\n');let value;try{value=Buffer.from('synthetic') instanceof fs.Stats;}catch(e){process.stdout.write('STATS_INSTANCEOF_ERROR '+JSON.stringify({name:e.name,message:e.message})+'\n');throw e;}if(value!==false)throw Error('EXPECTED_FALSE_STATS_INSTANCEOF');process.stdout.write('STATS_INSTANCEOF_FALSE\n');"
        _, _, stdout = self.run_code(self.output(code))
        self.assertIn(b'STATS_INSTANCEOF_FALSE\n', stdout)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['status'], 'RECORDED'); self.assertEqual(receipt['violations'], [])
        self.assertEqual(receipt['transport_calls'], 0)

    def test_pinned_etag_accepts_native_buffer_without_stats_io(self):
        source_sha256 = self.bind_pinned_etag_source()
        # Absolute exact index avoids inventing/copying package metadata or a package graph node.
        code = r"process.stdout.write('PINNED_ETAG_BEFORE\n');const etag=require(process.env.NODE_PATH+'/etag/index.js'),actual=etag(new Buffer('synthetic','utf8'),{weak:true});if(actual!==EXPECTED)throw Error('PINNED_ETAG_MISMATCH');process.stdout.write('PINNED_ETAG_RETURNED '+JSON.stringify(actual)+'\n');".replace('EXPECTED', json.dumps(PINNED_ETAG_EXPECTED))
        _, _, stdout = self.run_code(self.output(code))
        self.assertIn(('PINNED_ETAG_RETURNED ' + json.dumps(PINNED_ETAG_EXPECTED) + '\n').encode(), stdout)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['status'], 'RECORDED'); self.assertEqual(receipt['violations'], [])
        self.assertEqual(receipt['transport_calls'], 0)
        etag_path = str(self.roots['s02'] / 'node_modules/etag/index.js')
        self.assertIn({'filename': etag_path, 'sha256': source_sha256}, receipt['cjs_compiles'])
        self.assertEqual([row for row in receipt['vm_calls'] if row['filename'] == 'structured-stack'], [NODE_STRUCTURED_STACK_ENTRY])

    def test_stats_call_and_construction_remain_exactly_denied(self):
        for code in ("require('fs').Stats();", "new (require('fs').Stats)();"):
            with self.subTest(code=code):
                _, _, stdout = self.run_code(self.output(code), 'ORACLE_DENIED filesystem Stats')
                receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
                self.assertEqual(receipt['status'], 'DENIED')
                self.assertEqual(receipt['violations'], ['filesystem Stats'])
                self.assertEqual(receipt['transport_calls'], 0)
                self.assertEqual(receipt['owned_ports_remaining'], 0)
                self.assertEqual(receipt['owned_sockets_remaining'], 0)

    def test_raw_body_real_parent_callback_and_clean_audit(self):
        base = self.bind_verified_s02_readonly()
        prefix = 'const read=require(' + json.dumps(str(base / 'node_modules/raw-body/index.js')) + ');'
        code = prefix + r"const input=new(require('stream').PassThrough)();let count=0;read(input,{length:9,limit:1024},(error,body)=>{if(error||body.toString('utf8')!=='synthetic')throw Error('RAW_BODY_RESULT');count++;setImmediate(()=>{if(count!==1)throw Error('RAW_BODY_CALLBACK_COUNT');process.stdout.write('RAW_BODY_CALLBACK_ONCE synthetic\n');OUTPUT});});input.end(Buffer.from('synthetic'));"
        _, _, stdout = self.run_code(code.replace('OUTPUT', self.output()))
        self.assertEqual(stdout.count(b'RAW_BODY_CALLBACK_ONCE synthetic\n'), 1)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['status'], 'RECORDED'); self.assertEqual(receipt['violations'], [])
        self.assertEqual(receipt['dependency_file_count'], 4470); self.assertEqual(receipt['transport_calls'], 0)
        self.assert_async_parent_compiled(receipt, base, 'raw-body')

    def test_on_finished_real_parent_callback_and_clean_audit(self):
        base = self.bind_verified_s02_readonly()
        prefix = 'const onFinished=require(' + json.dumps(str(base / 'node_modules/on-finished/index.js')) + ');'
        code = prefix + r"const h=require('http');let count=0;const s=h.createServer((q,r)=>{onFinished(r,(error,message)=>{if(error||message!==r)throw Error('ON_FINISHED_RESULT');count++;});r.end('synthetic');});s.listen(0,'127.0.0.1',()=>{const q=h.request({host:'127.0.0.1',port:s.address().port,method:'GET',agent:false},r=>{const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>{if(r.statusCode!==200||Buffer.concat(chunks).toString('utf8')!=='synthetic')throw Error('ON_FINISHED_WIRE');setImmediate(()=>{if(count!==1)throw Error('ON_FINISHED_CALLBACK_COUNT');s.close(()=>setImmediate(()=>{process.stdout.write('ON_FINISHED_CALLBACK_ONCE synthetic\n');OUTPUT}));});});});q.end();});"
        _, _, stdout = self.run_code(code.replace('OUTPUT', self.output()))
        self.assertEqual(stdout.count(b'ON_FINISHED_CALLBACK_ONCE synthetic\n'), 1)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['status'], 'RECORDED'); self.assertEqual(receipt['violations'], [])
        self.assertEqual(receipt['dependency_file_count'], 4470); self.assertEqual(receipt['transport_calls'], 1)
        self.assertEqual(receipt['owned_ports_remaining'], 0); self.assertEqual(receipt['owned_sockets_remaining'], 0)
        self.assert_async_parent_compiled(receipt, base, 'on-finished')

    def test_async_hooks_exact_parent_hash_root_profile_spelling_and_cache(self):
        # Wrong-byte negative only: this is an admitted synthetic file, never a fake positive.
        wrong = self.roots['s02'] / 'node_modules/raw-body/index.js'
        wrong.parent.mkdir(); wrong.write_text("module.exports=require('async_hooks');")
        self.assertNotEqual(d.sha(wrong), VERIFIED_ASYNC_PARENTS['raw-body']); self.reindex('s02')
        _, _, stdout = self.run_code(self.output('require(' + json.dumps(str(wrong)) + ');'), 'ORACLE_DENIED builtin async_hooks')
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['violations'], ['builtin async_hooks'])
        self.assertIn({'filename': str(wrong), 'sha256': d.sha(wrong)}, receipt['cjs_compiles'])
        # Real import populates the actual builtin cache, then every unselected access still denies.
        base = self.bind_verified_s02_readonly(); selected = str(base / 'node_modules/raw-body/index.js')
        common = str(EVIDENCE.parent / 'phase4-b2/common-deps/node_modules/raw-body/index.js')
        cases = [
            ['driver-bare', 'async_hooks', None], ['driver-node-alias', 'node:async_hooks', None],
            ['other-allowed-parent', 'async_hooks', str(base / 'node_modules/bytes/index.js')],
            ['same-source-wrong-root', 'async_hooks', common],
            ['selected-parent-node-alias', 'node:async_hooks', selected], ['null-parent', 'async_hooks', None],
        ]
        code = 'require(' + json.dumps(selected) + ');const M=require("module"),cases=' + json.dumps(cases) + ';'
        code += r"for(const [label,id,parent]of cases){let denied=false;try{if(label.startsWith('driver-'))require(id);else M._load(id,parent?{filename:parent}:null,false);}catch(e){if(e.message!=='ORACLE_DENIED builtin async_hooks')throw e;denied=true;}if(!denied)throw Error('MISSING_ASYNC_DENIAL '+label);process.stdout.write('ASYNC_EXACT_NEGATIVE '+label+'\n');}"
        _, _, stdout = self.run_code(self.output(code), 'builtin async_hooks')
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['violations'], ['builtin async_hooks'] * len(cases))
        self.assertEqual(stdout.count(b'ASYNC_EXACT_NEGATIVE '), len(cases))
        self.assert_async_parent_compiled(receipt, base, 'raw-body')
        # The other four selected profiles now admit only their own exact two parents.
        # Exercise each selected real cache, then preserve all six unselected accesses.
        # Explicit Module metadata tests gate arguments, not authenticated caller identity.
        for variant in ('older', 'town', 'core', 'rich'):
            with self.subTest(selected_variant=variant):
                base = self.bind_verified_rich_readonly() if variant == 'rich' else self.bind_verified_s02_readonly()
                selected = str(base / 'node_modules/raw-body/index.js')
                cases = [
                    ['driver-bare', 'async_hooks', None], ['driver-node-alias', 'node:async_hooks', None],
                    ['other-allowed-parent', 'async_hooks', str(base / 'node_modules/bytes/index.js')],
                    ['same-source-wrong-root', 'async_hooks', common],
                    ['selected-parent-node-alias', 'node:async_hooks', selected], ['null-parent', 'async_hooks', None],
                ]
                code = 'require(' + json.dumps(selected) + ');const M=require("module"),cases=' + json.dumps(cases) + ';'
                code += r"for(const [label,id,parent]of cases){let denied=false;try{if(label.startsWith('driver-'))require(id);else M._load(id,parent?{filename:parent}:null,false);}catch(e){if(e.message!=='ORACLE_DENIED builtin async_hooks')throw e;denied=true;}if(!denied)throw Error('MISSING_ASYNC_DENIAL '+label);process.stdout.write('ASYNC_EXACT_NEGATIVE '+label+'\n');}"
                _, _, stdout = self.run_code(self.output(code), 'builtin async_hooks', variant=variant)
                receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
                self.assertEqual(receipt['violations'], ['builtin async_hooks'] * len(cases))
                self.assertEqual(stdout.count(b'ASYNC_EXACT_NEGATIVE '), len(cases))
                self.assertEqual(receipt['transport_calls'], 0)
                self.assert_async_parent_compiled(receipt, base, 'raw-body')

    def assert_profile_native_buffer_returns(self, variant):
        # Test-local declaration isolates the old guard's profile rejection, not policy absence.
        entries = self.spec['variants'][variant]['vm_entries']
        if NODE_STRUCTURED_STACK_ENTRY not in entries:
            entries.append(dict(NODE_STRUCTURED_STACK_ENTRY))
        code = r"process.stdout.write('NATIVE_BUFFER_BEFORE\n');const a=new Buffer('synthetic','utf8'),b=new Buffer('second','utf8');if(a.toString()!=='synthetic'||b.toString()!=='second')throw Error('BUFFER_BYTES');process.stdout.write('NATIVE_BUFFER_RETURNED\n');"
        _, _, stdout = self.run_code(self.output(code), variant=variant)
        self.assertIn(b'NATIVE_BUFFER_BEFORE\n', stdout)
        self.assertIn(b'NATIVE_BUFFER_RETURNED\n', stdout)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['status'], 'RECORDED'); self.assertEqual(receipt['violations'], [])
        self.assertEqual([row for row in receipt['vm_calls'] if row['filename'] == 'structured-stack'], [NODE_STRUCTURED_STACK_ENTRY])

    def assert_profile_raw_body_real_parent_callback_and_clean_audit(self, variant):
        base = self.bind_verified_rich_readonly() if variant == 'rich' else self.bind_verified_s02_readonly()
        prefix = 'const read=require(' + json.dumps(str(base / 'node_modules/raw-body/index.js')) + ');'
        code = prefix + r"const input=new(require('stream').PassThrough)();let count=0;read(input,{length:9,limit:1024},(error,body)=>{if(error||body.toString('utf8')!=='synthetic')throw Error('RAW_BODY_RESULT');count++;setImmediate(()=>{if(count!==1)throw Error('RAW_BODY_CALLBACK_COUNT');process.stdout.write('RAW_BODY_CALLBACK_ONCE synthetic\n');OUTPUT});});input.end(Buffer.from('synthetic'));"
        _, _, stdout = self.run_code(code.replace('OUTPUT', self.output()), variant=variant)
        self.assertEqual(stdout.count(b'RAW_BODY_CALLBACK_ONCE synthetic\n'), 1)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['status'], 'RECORDED'); self.assertEqual(receipt['violations'], [])
        self.assertEqual(receipt['dependency_file_count'], 5112 if variant == 'rich' else 4470 + (len(d.load(self.maps['models'])['regular_files']) if variant == 'core' else 0)); self.assertEqual(receipt['transport_calls'], 0)
        self.assert_async_parent_compiled(receipt, base, 'raw-body')


    def assert_profile_on_finished_real_parent_callback_and_clean_audit(self, variant):
        base = self.bind_verified_rich_readonly() if variant == 'rich' else self.bind_verified_s02_readonly()
        prefix = 'const onFinished=require(' + json.dumps(str(base / 'node_modules/on-finished/index.js')) + ');'
        code = prefix + r"const h=require('http');let count=0;const s=h.createServer((q,r)=>{onFinished(r,(error,message)=>{if(error||message!==r)throw Error('ON_FINISHED_RESULT');count++;});r.end('synthetic');});s.listen(0,'127.0.0.1',()=>{const q=h.request({host:'127.0.0.1',port:s.address().port,method:'GET',agent:false},r=>{const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>{if(r.statusCode!==200||Buffer.concat(chunks).toString('utf8')!=='synthetic')throw Error('ON_FINISHED_WIRE');setImmediate(()=>{if(count!==1)throw Error('ON_FINISHED_CALLBACK_COUNT');s.close(()=>setImmediate(()=>{process.stdout.write('ON_FINISHED_CALLBACK_ONCE synthetic\n');OUTPUT}));});});});q.end();});"
        _, _, stdout = self.run_code(code.replace('OUTPUT', self.output()), variant=variant)
        self.assertEqual(stdout.count(b'ON_FINISHED_CALLBACK_ONCE synthetic\n'), 1)
        receipt = next(json.loads(line) for line in stdout.decode().splitlines() if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['status'], 'RECORDED'); self.assertEqual(receipt['violations'], [])
        self.assertEqual(receipt['dependency_file_count'], 5112 if variant == 'rich' else 4470 + (len(d.load(self.maps['models'])['regular_files']) if variant == 'core' else 0)); self.assertEqual(receipt['transport_calls'], 1)
        self.assertEqual(receipt['owned_ports_remaining'], 0); self.assertEqual(receipt['owned_sockets_remaining'], 0)
        self.assert_async_parent_compiled(receipt, base, 'on-finished')


    def test_older_native_buffer_returns(self):
        self.assert_profile_native_buffer_returns('older')

    def test_older_raw_body_callback_and_clean_audit(self):
        self.assert_profile_raw_body_real_parent_callback_and_clean_audit('older')

    def test_older_on_finished_callback_and_clean_audit(self):
        self.assert_profile_on_finished_real_parent_callback_and_clean_audit('older')

    def test_town_native_buffer_returns(self):
        self.assert_profile_native_buffer_returns('town')

    def test_town_raw_body_callback_and_clean_audit(self):
        self.assert_profile_raw_body_real_parent_callback_and_clean_audit('town')

    def test_town_on_finished_callback_and_clean_audit(self):
        self.assert_profile_on_finished_real_parent_callback_and_clean_audit('town')

    def test_core_native_buffer_returns(self):
        self.assert_profile_native_buffer_returns('core')

    def test_core_raw_body_callback_and_clean_audit(self):
        self.assert_profile_raw_body_real_parent_callback_and_clean_audit('core')

    def test_core_on_finished_callback_and_clean_audit(self):
        self.assert_profile_on_finished_real_parent_callback_and_clean_audit('core')

    def test_rich_native_buffer_returns(self):
        self.assert_profile_native_buffer_returns('rich')

    def test_rich_raw_body_callback_and_clean_audit(self):
        self.assert_profile_raw_body_real_parent_callback_and_clean_audit('rich')

    def test_rich_on_finished_callback_and_clean_audit(self):
        self.assert_profile_on_finished_real_parent_callback_and_clean_audit('rich')

    def test_all_five_actual_profiles_declare_exact_node_virtual_pair(self):
        actual = d.load(ROOT / d.TOOLS / 'policies/domestic_http.json')
        self.assertEqual(set(actual['variants']), {'kma', 'older', 'town', 'core', 'rich'})
        for variant, selected in actual['variants'].items():
            with self.subTest(variant=variant):
                self.assertEqual(selected['vm_entries'].count(NODE_STRUCTURED_STACK_ENTRY), 1)


    def test_mapped_file_descendant_exists_preserves_absence(self):
        code = 'const fs=require("fs");if(fs.existsSync(process.argv[1]+"/package.json"))throw Error("file child exists");if(fs.existsSync(process.argv[1]+"/nested/package.json"))throw Error("nested file child exists");'
        self.run_code(self.output(code))

    def test_cached_mongoose_noop_survives_reload(self):
        code = 'const m=require("mongoose"),noop=()=>Promise.resolve("oracle");m.connect=noop;if(require("mongoose").connect!==noop)throw Error("oracle no-op overwritten");'
        self.run_code(self.output(code), variant='core')

    def make_mongodb_control(self):
        self.assertTrue(self.roots['models'].is_relative_to(self.root))
        base = self.roots['models'] / 'node_modules/mongodb'; base.mkdir(exist_ok=True)
        (base / 'index.js').write_text('function C(){};module.exports={MongoClient:C};')
        (base / 'package.json').write_text('{"name":"mongodb","version":"synthetic","main":"index.js"}')
        self.reindex('models')
        return str(base / 'index.js')

    def test_cached_mongodb_noop_survives_reload(self):
        target = json.dumps(self.make_mongodb_control())
        code = 'const x=require(' + target + '),noop=()=>"oracle";x.MongoClient.connect=noop;x.MongoClient.prototype.connect=noop;const y=require(' + target + ');if(y.MongoClient.connect!==noop||y.MongoClient.prototype.connect!==noop)throw Error("MongoClient no-op overwritten");'
        self.run_code(self.output(code), variant='core')

    def test_cached_db_and_fresh_exports_remain_denied(self):
        for api in ['connect', 'createConnection', 'Mongoose.prototype.connect', 'Mongoose.prototype.createConnection', 'Connection.prototype.openUri', 'Connection.prototype.openSet']:
            code = 'let m=require("mongoose");require("mongoose");m.' + api + '();'
            self.run_code(code, 'ORACLE_DENIED mongoose ', variant='core')
        self.run_code('let m=require("mongoose");m.connect=()=>"old";delete require.cache[require.resolve("mongoose")];require("mongoose").connect();', 'ORACLE_DENIED mongoose connect', variant='core')
        target = json.dumps(self.make_mongodb_control())
        for expression in ['x.MongoClient.connect()', '(new x.MongoClient()).connect()']:
            self.run_code('const x=require(' + target + ');require(' + target + ');' + expression, 'ORACLE_DENIED MongoClient.connect', variant='core')
        self.run_code('let x=require(' + target + ');x.MongoClient.connect=()=>"old";delete require.cache[require.resolve(' + target + ')];require(' + target + ').MongoClient.connect();', 'ORACLE_DENIED MongoClient.connect', variant='core')

    def test_optional_package_directory_probes_preserve_absence(self):
        self.assertTrue(self.roots['models'].is_relative_to(self.root))
        base = self.roots['models'] / 'node_modules/mongoose/probe'; base.mkdir()
        (base / 'helper.js').write_text('module.exports={};'); self.reindex('models')
        existing = self.roots['models'] / 'node_modules/mongoose/package.json'
        code = 'const fs=require("fs");if(!fs.existsSync(' + json.dumps(str(base)) + ')||!fs.existsSync(' + json.dumps(str(existing)) + '))throw Error("known directory/package lost");if(fs.existsSync(' + json.dumps(str(base / 'package.json')) + '))throw Error("missing package exists");'
        self.run_code(self.output(code), variant='core')

    def test_optional_absence_does_not_admit_private_metadata(self):
        base = self.roots['models'] / 'node_modules/mongoose'
        for target in [self.root / 'private/package.json', base / 'unlisted-secret.json', self.root / 'server/not-mapped/package.json', base / 'no-such-dir/package.json', base / 'not-mapped.js/package.json']:
            _,_,stdout=self.run_code(self.output('try{require("fs").existsSync(' + json.dumps(str(target)) + ');}catch(e){}'), 'private metadata '+str(target), variant='core')
            receipt=next(json.loads(line)for line in stdout.decode().splitlines()if line.startswith('{"oracle_guard":'))
            self.assertEqual(receipt['violations'],['private metadata '+str(target)])
        # Non-existence semantics are confined to existsSync, never stat or reads.
        target = json.dumps(str(base / 'index.js/package.json'))
        self.run_code('require("fs").statSync(' + target + ')', 'ORACLE_DENIED private metadata ', variant='core')
        self.run_code('require("fs").readFileSync(' + target + ')', 'ORACLE_DENIED private read', variant='core')
        self.run_code('require("net").connect({host:"127.0.0.1",port:9})', 'ORACLE_DENIED unowned socket connect', variant='core')

    def test_optional_package_manifest_symlink_remains_denied(self):
        self.assertTrue(self.roots['models'].is_relative_to(self.root))
        base = self.roots['models'] / 'node_modules/.bin'; base.mkdir()
        (base / 'known.js').write_text('module.exports={};'); self.reindex('models')
        link = base / 'package.json'; link.symlink_to('../mongoose/package.json')
        installed = d.load(self.maps['models']); installed['symlinks']['node_modules/.bin/package.json'] = '../mongoose/package.json'
        self.maps['models'].write_text(json.dumps(installed))
        _,_,stdout=self.run_code(self.output('try{require("fs").existsSync(' + json.dumps(str(link)) + ');}catch(e){}'), 'private metadata '+str(link), variant='core')
        receipt=next(json.loads(line)for line in stdout.decode().splitlines()if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['violations'],['private metadata '+str(link)])

    def bind_verified_models_readonly(self):
        base = EVIDENCE.parent / 'phase2-toolchain/mongoose-deps'
        manifest = EVIDENCE.parent / 'phase2-toolchain/installed-files.json'
        self.assertEqual(d.sha(d.regular(manifest)), '2d00fa41a8e505c3578b1a06cce03020400240894905dc544044004dc2a89fb4')
        meta = deepcopy(d.load(ROOT / d.TOOLS / 'policies/domestic_http.json')['dependency_roots']['models'])
        for name,key in [('package.json','manifest_sha256'),('package-lock.json','lock_sha256')]:
            source = d.regular(base / name).read_bytes(); self.assertEqual(hashlib.sha256(source).hexdigest(),meta[key]); (self.root / meta['manifest_dir'] / name).write_bytes(source)
        self.spec['dependency_roots']['models']=meta;self.roots['models']=base;self.maps['models']=manifest
        self.verified_models_binding = {'root':str(base),'map':str(manifest),'map_sha256':d.sha(manifest),'dependency_tree_copied_or_modified':False,'synthetic_manifest_copies':2}
        return base

    def actual_optional_chain(self, variant, base):
        code='const fs=require("fs"),probes=[],exists=fs.existsSync;fs.existsSync=function(p){const result=exists(p);if(typeof p==="string"&&p.endsWith("/package.json"))probes.push({path:p,exists:result});return result;};const m=require("mongoose"),noop=()=>Promise.resolve();m.connect=noop;if(require("mongoose").connect!==noop)throw Error("real model no-op lost");const optional=require(' + json.dumps(str(base / 'node_modules/require_optional')) + ');for(const name of ["bson-ext","snappy","kerberos"])if(optional(name)!==undefined)throw Error("unexpected optional package "+name);process.stdout.write("OPTIONAL_PROBES "+JSON.stringify(probes)+"\\n");'
        _,_,stdout = self.run_code(self.output(code),variant=variant)
        text=stdout.decode();probes=json.loads(next(line.removeprefix('OPTIONAL_PROBES ')for line in text.splitlines()if line.startswith('OPTIONAL_PROBES ')))
        self.assertIn({'path':str(base / 'node_modules/require_optional/index.js/package.json'),'exists':False},probes)
        self.assertIn({'path':str(base / 'node_modules/mongodb-core/package.json'),'exists':True},probes)
        installed=d.load(self.maps['models' if variant=='core'else'rich'])
        regular={base / name for name in installed['regular_files']};links={base / name for name in installed['symlinks']}
        directories={parent for file in regular for parent in file.parents}
        for probe in probes:
            path=Path(probe['path']);self.assertNotIn(path,links)
            if path in regular or path in directories:
                self.assertTrue(probe['exists'])
            else:
                inferable=any(parent in regular for parent in path.parents)or(path.name=='package.json'and path.parent in directories and path.parent!=base/'node_modules'and path.parent.is_relative_to(base/'node_modules'))
                self.assertTrue(inferable,probe);self.assertFalse(probe['exists'])
        receipt=next(json.loads(line)for line in text.splitlines()if line.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['violations'],[])

    def test_actual_models_optional_chain_and_cached_noop(self):
        base=self.bind_verified_models_readonly();self.actual_optional_chain('core',base)

    def test_actual_rich_optional_chain_and_cached_noop(self):
        base=self.bind_verified_rich_readonly();self.actual_optional_chain('rich',base)

    def test_actual_models_direct_connection_still_denied(self):
        self.bind_verified_models_readonly()
        _,_,stdout=self.run_code('require("mongoose").connect("mongodb://127.0.0.1")','ORACLE_DENIED mongoose connect',variant='core')
        receipt=next(json.loads(x)for x in stdout.decode().splitlines()if x.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['violations'],['mongoose connect'])


    def terminal_wire_code(self, finish='process.exit(0);', connection_close=True, incomplete=False, method='GET', status=200):
        # Source-derived inert CORE/Rich wire pattern; no original export or handler runs.
        code = r'''const h=require('http'),tracked=new Map(),closed=new Set();let responseComplete=false,responseEnded=false;
const server=h.createServer((q,r)=>{__RESPONSE__});
server.on('connection',s=>{tracked.set(s,'server');s.once('close',()=>closed.add(s));});
async function wire(){
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 const port=server.address().port;
 try{await new Promise((ok,bad)=>{const req=h.request({host:'127.0.0.1',port,method:__METHOD__,headers:__HEADERS__,agent:false},res=>{__CONSUME__});req.on('socket',s=>{tracked.set(s,'client');s.once('close',()=>closed.add(s));});req.setTimeout(15000,()=>req.destroy(Error('case timeout')));req.on('error',bad);req.end();});}
 finally{for(const [s,role]of tracked)if(role==='server')s.destroy();await new Promise(ok=>server.close(ok));}
}
wire().then(()=>{__OUTPUT__;const rows=[...tracked].map(([s,role])=>({role,destroyed:s.destroyed,handle_null:s._handle===null,ready_state:s.readyState,writable_ended:s.writableEnded,readable_ended:s.readableEnded,response_complete:role==='client'?responseComplete:null,response_end_seen:role==='client'?responseEnded:null,close_seen:closed.has(s)}));process.stdout.write('TERMINAL_SOCKETS '+JSON.stringify(rows)+'\n');__FINISH__}).catch(e=>{console.error(e.stack);process.exit(1);});'''
        response="r.writeHead(200,{'content-length':'100'});r.write('partial');" if incomplete else("r.writeHead(304);r.end();"if status==304 else"r.end('terminal-inert');")
        consume="res.once('data',()=>{res.pause();res.socket.pause();ok();});" if incomplete else "res.resume();res.on('end',()=>{responseComplete=res.complete;responseEnded=true;ok();});"
        return code.replace('__OUTPUT__',self.output()).replace('__FINISH__',finish).replace('__HEADERS__',"{connection:'close'}"if connection_close else'{}').replace('__RESPONSE__',response).replace('__CONSUME__',consume).replace('__METHOD__',json.dumps(method))

    def assert_terminal_wire_observes_close(self, variant):
        _,_,stdout=self.run_code(self.terminal_wire_code(),variant=variant)
        lines=stdout.decode().splitlines();states=json.loads(next(x.removeprefix('TERMINAL_SOCKETS ')for x in lines if x.startswith('TERMINAL_SOCKETS ')))
        self.assertEqual(sorted(x['role']for x in states),['client','server'])
        client=next(x for x in states if x['role']=='client');server=next(x for x in states if x['role']=='server')
        self.assertFalse(client['destroyed']);self.assertTrue(client['response_complete']and client['response_end_seen']and client['writable_ended']);self.assertTrue(server['destroyed'])
        receipt=next(json.loads(x)for x in lines if x.startswith('{"oracle_guard":'))
        self.assertEqual(receipt['owned_sockets_remaining'],0);self.assertEqual(receipt['violations'],[])
        audit=receipt['terminal_close_drain'];self.assertTrue(audit['deferred']);self.assertEqual(audit['sockets_at_request'],2);self.assertEqual(audit['observed_closes'],2);self.assertEqual(audit['completed_clients_at_request'],1)

    def test_terminal_core_wire_observes_close_before_exit(self):
        self.assert_terminal_wire_observes_close('core')

    def test_terminal_rich_wire_observes_close_before_exit(self):
        self.assert_terminal_wire_observes_close('rich')


    @staticmethod
    def terminal_receipt(stdout):
        return next(json.loads(line)for line in stdout.decode().splitlines()if line.startswith('{"oracle_guard":'))

    def test_terminal_incomplete_response_is_not_deferred(self):
        _,_,stdout=self.run_code(self.terminal_wire_code(incomplete=True),'owned HTTP not retired',variant='core')
        receipt=self.terminal_receipt(stdout);self.assertFalse(receipt['terminal_close_drain']['deferred']);self.assertEqual(receipt['owned_ports_remaining'],0)
        rows=json.loads(next(x.removeprefix('TERMINAL_SOCKETS ')for x in stdout.decode().splitlines()if x.startswith('TERMINAL_SOCKETS ')))
        client=next(x for x in rows if x['role']=='client');self.assertFalse(client['response_end_seen']);self.assertFalse(client['response_complete'])

    def test_terminal_missing_explicit_connection_close_is_not_deferred(self):
        _,_,stdout=self.run_code(self.terminal_wire_code(connection_close=False),'owned HTTP not retired',variant='core')
        self.assertFalse(self.terminal_receipt(stdout)['terminal_close_drain']['deferred'])

    def test_terminal_open_listener_and_live_socket_are_not_deferred(self):
        code="const h=require('http'),s=h.createServer((q,r)=>{r.writeHead(200,{'content-length':'100'});r.write('partial');});s.listen(0,'127.0.0.1',()=>{const req=h.request({host:'127.0.0.1',port:s.address().port,agent:false,headers:{connection:'close'}},res=>{res.once('data',()=>{OUTPUT;process.exit(0);});});req.end();});"
        _,_,stdout=self.run_code(code.replace('OUTPUT',self.output()),'owned HTTP not retired',variant='core')
        receipt=self.terminal_receipt(stdout);self.assertFalse(receipt['terminal_close_drain']['deferred']);self.assertEqual(receipt['owned_ports_remaining'],1);self.assertGreater(receipt['owned_sockets_remaining'],0)

    def test_terminal_missing_close_observers_still_fail(self):
        finish="for(const [s]of tracked)s.removeAllListeners('close');process.exit(0);"
        info,_,stdout=self.run_code(self.terminal_wire_code(finish),'owned HTTP not retired',variant='core')
        receipt=self.terminal_receipt(stdout);self.assertTrue(receipt['terminal_close_drain']['deferred']);self.assertEqual(receipt['terminal_close_drain']['observed_closes'],0);self.assertEqual(receipt['owned_sockets_remaining'],2);self.assertEqual(info['exit_code'],2)

    def test_terminal_nonzero_and_reentrant_exit_preserve_guard_mapping(self):
        info,_,stdout=self.run_code(self.output()+'process.exit(1);','"status":"ERROR"',variant='core')
        self.assertEqual(info['exit_code'],1);self.assertFalse(self.terminal_receipt(stdout)['terminal_close_drain']['deferred'])
        info,_,stdout=self.run_code(self.terminal_wire_code('process.exit(1);'),'owned HTTP not retired',variant='core')
        self.assertEqual(info['exit_code'],2);self.assertFalse(self.terminal_receipt(stdout)['terminal_close_drain']['deferred'])
        info,_,stdout=self.run_code(self.terminal_wire_code('process.exit(0);process.exit(1);'),'owned HTTP not retired',variant='core')
        receipt=self.terminal_receipt(stdout);self.assertTrue(receipt['terminal_close_drain']['deferred']);self.assertEqual(receipt['terminal_close_drain']['reentrant_exit_code'],1);self.assertEqual(info['exit_code'],2)

    def test_terminal_exit_before_output_is_not_deferred(self):
        _,_,stdout=self.run_code('process.exit(0);','record not written',variant='core')
        self.assertFalse(self.terminal_receipt(stdout)['terminal_close_drain']['deferred'])

    def test_terminal_late_io_is_denied_and_audited(self):
        cases=[('HTTP',"h.request({host:'127.0.0.1',port:9,agent:false});"),('socket',"require('net').connect({host:'127.0.0.1',port:9});"),('server',"h.createServer(()=>{});"),('output',self.output())]
        for operation,attempt in cases:
            with self.subTest(operation=operation):
                finish='process.exit(0);try{'+attempt+'}catch(e){}'
                _,_,stdout=self.run_code(self.terminal_wire_code(finish),'terminal work '+operation,variant='core')
                receipt=self.terminal_receipt(stdout);self.assertEqual(receipt['violations'],['terminal work '+operation]);self.assertEqual(receipt['transport_calls'],1);self.assertTrue(receipt['terminal_close_drain']['deferred']);self.assertEqual(receipt['owned_sockets_remaining'],0)
        finish="const late=h.createServer(()=>{});process.exit(0);try{late.listen(0,'127.0.0.1',()=>{});}catch(e){}"
        _,_,stdout=self.run_code(self.terminal_wire_code(finish),'terminal work listen',variant='core')
        self.assertEqual(self.terminal_receipt(stdout)['violations'],['terminal work listen'])

    def test_terminal_other_three_variants_are_not_deferred(self):
        for variant in ('kma','older','town'):
            with self.subTest(variant=variant):
                _,_,stdout=self.run_code(self.terminal_wire_code(),'owned HTTP not retired',variant=variant)
                self.assertFalse(self.terminal_receipt(stdout)['terminal_close_drain']['deferred'])


    def test_terminal_head_and_not_modified_finish_with_zero_sockets(self):
        # Actual CORE's final request is HEAD; conditional GET 304 is also in both corpora.
        for variant in ('core','rich'):
            for method,status in [('HEAD',200),('GET',304)]:
                with self.subTest(variant=variant,method=method,status=status):
                    _,_,stdout=self.run_code(self.terminal_wire_code(method=method,status=status),variant=variant)
                    receipt=self.terminal_receipt(stdout);self.assertEqual(receipt['owned_ports_remaining'],0);self.assertEqual(receipt['owned_sockets_remaining'],0);self.assertEqual(receipt['violations'],[])
                    audit=receipt['terminal_close_drain'];self.assertEqual(audit['observed_closes'],audit['sockets_at_request'])


    def terminal_nested_code(self, finish='process.exit(0);', before_exit=''):
        # Source-derived direct-backend + nested-gateway pattern, inert synthetic HTTP only.
        code = r"""const h=require('http'),tracked=new Map(),closed=new Set(),states=new WeakMap();let sequence=0;
const payload=Buffer.from('x'.repeat(97014));
async function wire(handler,label){
 const server=h.createServer(handler),serverSockets=new Set(),id=++sequence;
 server.on('connection',s=>{serverSockets.add(s);tracked.set(s,{role:'server',label,id});s.once('close',()=>{serverSockets.delete(s);closed.add(s);});});
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 try{return await new Promise((ok,bad)=>{const req=h.request({host:'127.0.0.1',port:server.address().port,path:'/',method:'GET',headers:{connection:'close'},agent:false},res=>{const chunks=[];const state=states.get(req.socket);state.response=res;res.on('data',c=>chunks.push(c));res.on('end',()=>{state.endSeen=true;ok(Buffer.concat(chunks));});});req.on('socket',s=>{tracked.set(s,{role:'client',label,id});states.set(s,{request:req,response:null,endSeen:false});s.once('close',()=>closed.add(s));});req.setTimeout(15000,()=>req.destroy(Error('case timeout')));req.on('error',bad);req.end();});}
 finally{for(const s of serverSockets)s.destroy();await new Promise(ok=>server.close(ok));}
}
async function run(){
 for(let round=0;round<2;round++){
  await wire((q,r)=>r.end(payload),'direct-'+round);
  await wire((q,r)=>{wire((innerQ,innerR)=>innerR.end(payload),'inner-'+round).then(body=>{r.setHeader('content-type','application/json');r.end(body);},e=>{console.error(e.stack);process.exit(1);});},'outer-'+round);
 }
 __OUTPUT__;__STATE_OVERRIDE__
 const rows=[...tracked].map(([s,meta])=>{const state=states.get(s);return {...meta,destroyed:s.destroyed,handle_null:s._handle===null,ready_state:s.readyState,readable_ended:s.readableEnded,writable_ended:s.writableEnded,writable_finished:s.writableFinished,request_writable_ended:state?state.request.writableEnded:null,response_complete:state&&state.response?state.response.complete:null,response_end_seen:state?state.endSeen:null,close_seen:closed.has(s)};});
 process.stdout.write('TERMINAL_NESTED_SOCKETS '+JSON.stringify(rows)+'\n');__FINISH__
}
run().catch(e=>{console.error(e.stack);process.exit(1);});"""
        return code.replace('__OUTPUT__',self.output()).replace('__FINISH__',finish).replace('__STATE_OVERRIDE__',before_exit)

    def assert_terminal_nested_closes(self, variant):
        _,_,stdout=self.run_code(self.terminal_nested_code(),variant=variant)
        receipt=self.terminal_receipt(stdout)
        self.assertEqual(receipt['owned_ports_remaining'],0);self.assertEqual(receipt['owned_sockets_remaining'],0);self.assertEqual(receipt['violations'],[])
        audit=receipt['terminal_close_drain'];self.assertTrue(audit['deferred']);self.assertEqual(audit['sockets_at_request'],3);self.assertEqual(audit['completed_clients_at_request'],2);self.assertEqual(audit['observed_closes'],3)
        self.assertEqual(audit['candidate_count'],3);self.assertFalse(audit['candidate_audit_truncated']);self.assertTrue(all(row['eligible']for row in audit['candidate_sockets']))
        inner=next(row for row in audit['candidate_sockets']if row['role']=='client'and row['ready_state']=='closed')
        self.assertTrue(inner['readable_ended']);self.assertFalse(inner['destroyed']);self.assertFalse(inner['writable_finished'])
        states=json.loads(next(x.removeprefix('TERMINAL_NESTED_SOCKETS ')for x in stdout.decode().splitlines()if x.startswith('TERMINAL_NESTED_SOCKETS ')))
        pending=[row for row in states if not row['close_seen']];self.assertEqual(len(pending),3)
        for row in audit['candidate_sockets']:
            matches=[state for state in pending if state['role']==row['role']and(row['role']=='server'or state['id']==row['request_id'])]
            self.assertEqual(len(matches),1)
            for field in ['destroyed','handle_null','ready_state','readable_ended','writable_ended','writable_finished','request_writable_ended','response_complete','response_end_seen']:
                self.assertEqual(row[field],matches[0][field],field)

    def test_terminal_nested_core_closes_all_owned_sockets(self):
        self.assert_terminal_nested_closes('core')

    def test_terminal_nested_rich_closes_all_owned_sockets(self):
        self.assert_terminal_nested_closes('rich')


    def test_terminal_nested_incomplete_observation_is_not_deferred(self):
        # Controlled boundary on real owned transport; actual partial-response coverage remains in the original61.
        override="for(const [s,m]of tracked)if(m.role==='client'&&m.label==='inner-1')states.get(s).response.complete=false;"
        _,_,stdout=self.run_code(self.terminal_nested_code(before_exit=override),'owned HTTP not retired',variant='core')
        receipt=self.terminal_receipt(stdout);audit=receipt['terminal_close_drain'];self.assertFalse(audit['deferred']);self.assertEqual(receipt['violations'],['owned HTTP not retired'])
        inner=next(row for row in audit['candidate_sockets']if row['role']=='client'and row['ready_state']=='closed')
        self.assertFalse(inner['response_complete']);self.assertFalse(inner['eligible']);self.assertTrue(inner['readable_ended'])

    def test_terminal_nested_unended_write_observation_is_not_deferred(self):
        # Synthetic read-only getter injection leaves the real socket's native state untouched.
        for target in ['socket','request']:
            with self.subTest(target=target):
                owner='s'if target=='socket'else'states.get(s).request'
                override="for(const [s,m]of tracked)if(m.role==='client'&&m.label==='inner-1')Object.defineProperty("+owner+",'writableEnded',{get:()=>false});"
                _,_,stdout=self.run_code(self.terminal_nested_code(before_exit=override),'owned HTTP not retired',variant='core')
                receipt=self.terminal_receipt(stdout);audit=receipt['terminal_close_drain'];self.assertFalse(audit['deferred']);self.assertEqual(receipt['violations'],['owned HTTP not retired'])
                inner=next(row for row in audit['candidate_sockets']if row['role']=='client'and row['ready_state']=='closed')
                self.assertFalse(inner['eligible']);self.assertFalse(inner['writable_ended']if target=='socket'else inner['request_writable_ended'])

if __name__ == '__main__':
    unittest.main()
