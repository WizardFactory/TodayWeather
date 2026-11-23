//! Lib tests that start a child process versus tests that re-acquire a released `flock`.
//!
//! A child shares the parent's open file descriptions until it execs. If another test
//! thread closes a file it had locked and immediately locks it again, the child's copy
//! keeps the old lock alive and `try_lock` fails with `WouldBlock`. The disk cache does
//! exactly that for its root `.capacity` lock, so its tests dropped fills (#3135). The
//! runtime starts no child processes; only these tests need to be kept apart.
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

static SPAWN: RwLock<()> = RwLock::new(());

/// Held by a test for as long as it may start child processes.
pub(crate) fn exclusive() -> RwLockWriteGuard<'static, ()> {
    SPAWN.write().unwrap_or_else(|p| p.into_inner())
}

/// Held by a test whose `flock` re-acquisition must not overlap a child's start.
pub(crate) fn shared() -> RwLockReadGuard<'static, ()> {
    SPAWN.read().unwrap_or_else(|p| p.into_inner())
}
