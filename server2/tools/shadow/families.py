"""Registry of families with S19 smoke/replay/rollback modules.

A family becomes READY when its port provides a module exposing:
SCENARIOS, run_scenario(), REPLAY_FIXTURE, REPLAY_LIMITATIONS, replay_side(),
oracle_cases() and rollback(). S11/S12/S13 families add entries here.
"""
import importlib

READY = ('gateway', 'kma')
MODULES = {'gateway': 'gateway_family', 'kma': 'kma_family'}


def load(family):
    if family not in READY:
        raise ValueError('family has no S19 module yet: ' + family)
    return importlib.import_module(MODULES[family])
