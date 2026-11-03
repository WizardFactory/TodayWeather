"""Air's separate synthetic controls; no actual recorder/legacy code execution."""
import unittest
import replay_air as a
from test_replay_nation import FixedBoundaryControls


class AirBoundary(FixedBoundaryControls,unittest.TestCase):
    API=a

    def test_recorded_export_source_identity_is_complete_and_exact(self):
        import json,gzip
        root,node,out,policy,spec=self.prepared()
        out.mkdir();p=out/'synthetic-record.gz';doc=self.payload(policy,spec)
        p.write_bytes(gzip.compress(json.dumps(doc).encode()))
        self.API.validate_record(p,policy['sources'],spec)
        name=spec['record_export_paths'][0];doc['source']['files'][name]='0'*64
        p.write_bytes(gzip.compress(json.dumps(doc).encode()))
        with self.assertRaisesRegex(ValueError,'complete air source'):self.API.validate_record(p,policy['sources'],spec)

    def test_truncated_gzip_is_retained_as_blocked(self):
        prepared=self.canary_prepared('const z=require("zlib");require("fs").writeFileSync(process.argv[2],z.gzipSync(Buffer.from("{}")).subarray(0,-8))')
        result=self.API.execute(prepared)
        self.assertEqual(result['status'],'BLOCKED')
        self.assertTrue(result['process_reaped'])
        self.assertIn('retained_failed_output',result)


if __name__=='__main__':unittest.main()
