import unittest

from inventory import inventory


class InventoryTests(unittest.TestCase):
    def node(self, result="Passed", arguments=('a', 'b')):
        return {
            "nodeIdentifier": "Suite/test()",
            "nodeType": "Test Case",
            "result": result,
            "children": [
                {"nodeType": "Arguments", "name": argument, "result": "Passed"}
                for argument in arguments
            ],
        }

    def test_rejects_missing_duplicate_and_skipped_cases(self):
        expected = {"Suite/test()": ["a", "b"]}
        for nodes in ([], [self.node(arguments=("a",))], [self.node()] * 2,
                      [self.node(result="Skipped")], [self.node(arguments=("a", "a"))]):
            with self.subTest(nodes=nodes), self.assertRaises(ValueError):
                inventory({"testNodes": nodes}, expected)
        skipped = self.node()
        skipped["children"][1]["result"] = "Skipped"
        with self.assertRaises(ValueError):
            inventory({"testNodes": [skipped]}, expected)

    def test_reports_expected_and_executed_parameters(self):
        expected = {"Suite/test()": ["b", "a"]}
        report = inventory({"testNodes": [self.node()]}, expected)
        self.assertEqual(report["Suite/test()"]["executed"], ["a", "b"])
        self.assertEqual(report["Suite/test()"]["expected"], ["a", "b"])

    def test_optional_runtime_warning_does_not_mask_test_result(self):
        node = self.node(arguments=())
        node["children"].append({"nodeType": "Runtime Warning", "name": "Warning"})
        inventory({"testNodes": [node]}, {"Suite/test()": []})


if __name__ == "__main__":
    unittest.main()
