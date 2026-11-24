"""Verify the expected cases against an Xcode test result report."""
import json
import sys


def inventory(report, expected):
    found = {}

    def visit(node):
        identifier = node.get("nodeIdentifier")
        if node["nodeType"] == "Test Case" and identifier in expected:
            if identifier in found:
                raise ValueError(f"Repeated test case: {identifier}")
            found[identifier] = node
        for child in node.get("children", ()):
            visit(child)

    for node in report["testNodes"]:
        visit(node)

    results = {}
    for identifier, cases in expected.items():
        node = found.get(identifier)
        if node is None or node.get("result") != "Passed":
            raise ValueError(f"Missing or unsuccessful test: {identifier}")
        arguments = [item for item in node.get("children", ()) if item["nodeType"] == "Arguments"]
        actual = sorted(item["name"] for item in arguments)
        if actual != sorted(cases) or any(item.get("result") != "Passed" for item in arguments):
            raise ValueError(f"{identifier}: expected {sorted(cases)}, got {arguments}")
        results[identifier] = {"expected": sorted(cases), "executed": actual, "result": "Passed"}
    return results


if __name__ == "__main__":
    with open(sys.argv[1]) as manifest, open(sys.argv[2]) as report:
        try:
            print(json.dumps(inventory(json.load(report), json.load(manifest)), indent=2))
        except (KeyError, ValueError) as exc:
            sys.exit(str(exc))
