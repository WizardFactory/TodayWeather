"""Preflight must reject incompatible or changed artifacts before execution."""
import importlib.util
from pathlib import Path
import struct
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('artifact', Path(__file__).with_name('verify_artifact.py'))
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)


def elf(machine=62, interpreter=False):
    header = bytearray(64)
    header[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<HHI', header, 16, 2, machine, 1)
    struct.pack_into('<Q', header, 32, 64)
    struct.pack_into('<HHH', header, 52, 64, 56, 1)
    program = bytearray(56)
    struct.pack_into('<I', program, 0, 3 if interpreter else 1)
    return header + program


class Preflight(unittest.TestCase):
    def test_curated_sources_include_transitive_peer_dependencies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in artifact.SOURCES:
                destination = root/name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(artifact.ROOT/name, destination)
            peer_spec = importlib.util.spec_from_file_location('staged_peer', root/'tools/benchmark/local_peer.py')
            peer_module = importlib.util.module_from_spec(peer_spec)
            peer_spec.loader.exec_module(peer_module)
            peer = peer_module.make()
            peer.server_close()

    def test_static_x86_64_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)/'binary'
            p.write_bytes(elf())
            artifact.check_elf(p)
            for body in (elf(183), elf(interpreter=True), b'not ELF', elf()[:65]):
                p.write_bytes(body)
                with self.assertRaises(ValueError):
                    artifact.check_elf(p)

    def test_manifest_binds_both_binaries_and_verification_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bins = root/'target/release'
            bins.mkdir(parents=True)
            for name in artifact.BINARIES:
                (bins/name).write_bytes(elf())
            for name in artifact.SOURCES:
                p = root/name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text('fixture')
            manifest = artifact.snapshot(root, bins)
            artifact.validate_manifest(manifest, manifest)
            for name in (*artifact.BINARIES, *artifact.SOURCES):
                p = bins/name if name in artifact.BINARIES else root/name
                original = p.read_bytes()
                p.write_bytes(original+b'changed')
                with self.assertRaises(ValueError):
                    artifact.validate_manifest(manifest, artifact.snapshot(root, bins))
                p.write_bytes(original)
            for invalid in ({}, dict(manifest, status='failed'), dict(manifest, schema=99)):
                with self.assertRaises(ValueError):
                    artifact.validate_manifest(invalid, manifest)


if __name__ == '__main__':
    unittest.main()
