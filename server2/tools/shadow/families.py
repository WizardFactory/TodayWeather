"""Registry of families with S19 smoke/replay/rollback modules.

READY means offline smoke/replay support, not cutover or rollback readiness.
Capability flags state rollback support separately. A module exposes:
SCENARIOS, run_scenario(), REPLAY_FIXTURE, REPLAY_LIMITATIONS, replay_side(),
oracle_cases() and rollback(). S11/S12/S13 families add entries here.
"""
import importlib

READY = ('gateway', 'kma', 'kma-rich')
MODULES = {'gateway': 'gateway_family', 'kma': 'kma_family', 'kma-rich': 'kma_rich_family'}
CAPABILITIES = {'gateway': {'smoke': True, 'replay': True, 'cache_recovery': True, 'rollback': True},
                'kma-rich': {'smoke': True, 'replay': True, 'cache_recovery': True, 'rollback': False},
                'kma': {'smoke': True, 'replay': True, 'cache_recovery': True, 'rollback': False}}


def load(family):
    if family not in READY:
        raise ValueError('family has no S19 module yet: ' + family)
    return importlib.import_module(MODULES[family])
