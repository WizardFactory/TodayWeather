use crate::storage::Error;
use std::{
    collections::{BTreeMap, HashMap, hash_map::RandomState},
    hash::{BuildHasher, Hash},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

/// Logical retained bytes. Allocation overhead and caller-owned copies are not RSS accounting.
pub struct ByteBudget {
    limit: usize,
    used: AtomicUsize,
}
impl ByteBudget {
    pub fn new(limit: usize) -> Result<Arc<Self>, Error> {
        if limit == 0 {
            return Err(Error::Invalid("byte budget"));
        }
        Ok(Arc::new(Self {
            limit,
            used: AtomicUsize::new(0),
        }))
    }
    pub fn used(&self) -> usize {
        self.used.load(Ordering::Acquire)
    }
    pub fn limit(&self) -> usize {
        self.limit
    }
    pub fn reserve(self: &Arc<Self>, weight: usize) -> Result<ByteLease, Error> {
        if weight == 0 || weight > self.limit {
            return Err(Error::Capacity);
        }
        let mut used = self.used();
        loop {
            let next = used
                .checked_add(weight)
                .filter(|n| *n <= self.limit)
                .ok_or(Error::Capacity)?;
            match self
                .used
                .compare_exchange_weak(used, next, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => {
                    return Ok(ByteLease {
                        budget: self.clone(),
                        weight,
                    });
                }
                Err(actual) => used = actual,
            }
        }
    }
}
/// Must remain owned by a started blocking job until that job finishes.
pub struct ByteLease {
    budget: Arc<ByteBudget>,
    weight: usize,
}
impl Drop for ByteLease {
    fn drop(&mut self) {
        self.budget.used.fetch_sub(self.weight, Ordering::AcqRel);
    }
}
pub struct WeightedValue<V> {
    pub value: V,
    _lease: ByteLease,
}
impl<V> WeightedValue<V> {
    pub fn charged(value: V, budget: &Arc<ByteBudget>, weight: usize) -> Result<Arc<Self>, Error> {
        Ok(Arc::new(Self {
            value,
            _lease: budget.reserve(weight)?,
        }))
    }
    pub fn weight(&self) -> usize {
        self._lease.weight
    }
}
struct Entry<V> {
    value: Arc<WeightedValue<V>>,
    tick: u64,
}
struct Shard<K, V> {
    entries: HashMap<K, Entry<V>>,
    order: BTreeMap<u64, K>,
    tick: u64,
}
/// Trusted callers must charge key, value and retained metadata, and bound any mutable allocation.
/// Bounded sharded hash lookup and O(log n) local LRU. No lock is held across async work.
pub struct WeightedCache<K, V> {
    budget: Arc<ByteBudget>,
    shards: Vec<Mutex<Shard<K, V>>>,
    hasher: RandomState,
    count: AtomicUsize,
    mapped_bytes: AtomicUsize,
    maximum_entries: usize,
}
impl<K: Eq + Hash + Clone, V> WeightedCache<K, V> {
    pub fn new(
        budget: Arc<ByteBudget>,
        shards: usize,
        maximum_entries: usize,
    ) -> Result<Self, Error> {
        if shards == 0 || shards > 64 || maximum_entries == 0 || maximum_entries > 16384 {
            return Err(Error::Invalid("cache bounds"));
        }
        Ok(Self {
            budget,
            shards: (0..shards)
                .map(|_| {
                    Mutex::new(Shard {
                        entries: HashMap::new(),
                        order: BTreeMap::new(),
                        tick: 0,
                    })
                })
                .collect(),
            hasher: RandomState::new(),
            count: AtomicUsize::new(0),
            mapped_bytes: AtomicUsize::new(0),
            maximum_entries,
        })
    }
    fn shard(&self, key: &K) -> usize {
        (self.hasher.hash_one(key) as usize) % self.shards.len()
    }
    fn evict(&self, start: usize) -> bool {
        for i in 0..self.shards.len() {
            if let Ok(mut shard) = self.shards[(start + i) % self.shards.len()].lock()
                && let Some((_, key)) = shard.order.pop_first()
                && let Some(old) = shard.entries.remove(&key)
            {
                self.count.fetch_sub(1, Ordering::AcqRel);
                self.mapped_bytes
                    .fetch_sub(old.value.weight(), Ordering::AcqRel);
                return true;
            }
        }
        false
    }
    pub fn insert(&self, key: K, value: V, weight: usize) -> Result<Arc<WeightedValue<V>>, Error> {
        if weight == 0 || weight > self.budget.limit() {
            return Err(Error::Capacity);
        }
        let index = self.shard(&key);
        self.remove(&key);
        let lease = loop {
            match self.budget.reserve(weight) {
                Ok(v) => break v,
                Err(e) => {
                    if !self.evict(index) {
                        return Err(e);
                    }
                }
            }
        };
        loop {
            let n = self.count.load(Ordering::Acquire);
            if n >= self.maximum_entries {
                if !self.evict(index) {
                    return Err(Error::Capacity);
                }
                continue;
            }
            if self
                .count
                .compare_exchange_weak(n, n + 1, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                break;
            }
        }
        let value = Arc::new(WeightedValue {
            value,
            _lease: lease,
        });
        let mut shard = match self.shards[index].lock() {
            Ok(v) => v,
            Err(_) => {
                self.count.fetch_sub(1, Ordering::AcqRel);
                return Err(Error::Transport);
            }
        };
        let Some(tick) = shard.tick.checked_add(1) else {
            self.count.fetch_sub(1, Ordering::AcqRel);
            return Err(Error::Capacity);
        };
        shard.tick = tick;
        // A concurrent same-key insert can replace a value after the earlier remove.
        if let Some(old) = shard.entries.remove(&key) {
            shard.order.remove(&old.tick);
            self.count.fetch_sub(1, Ordering::AcqRel);
            self.mapped_bytes
                .fetch_sub(old.value.weight(), Ordering::AcqRel);
        }
        self.mapped_bytes.fetch_add(weight, Ordering::AcqRel);
        shard.order.insert(tick, key.clone());
        shard.entries.insert(
            key,
            Entry {
                value: value.clone(),
                tick,
            },
        );
        Ok(value)
    }
    pub fn get(&self, key: &K) -> Option<Arc<WeightedValue<V>>> {
        let mut shard = self.shards[self.shard(key)].lock().ok()?;
        let old = shard.entries.get(key)?.tick;
        let tick = shard.tick.checked_add(1)?;
        shard.tick = tick;
        shard.order.remove(&old);
        shard.order.insert(tick, key.clone());
        let entry = shard.entries.get_mut(key)?;
        entry.tick = tick;
        Some(entry.value.clone())
    }
    pub fn remove(&self, key: &K) {
        if let Ok(mut shard) = self.shards[self.shard(key)].lock()
            && let Some(old) = shard.entries.remove(key)
        {
            shard.order.remove(&old.tick);
            self.count.fetch_sub(1, Ordering::AcqRel);
            self.mapped_bytes
                .fetch_sub(old.value.weight(), Ordering::AcqRel);
        }
    }
    pub fn clear(&self) {
        for lock in &self.shards {
            if let Ok(mut shard) = lock.lock() {
                let n = shard.entries.len();
                let bytes = shard.entries.values().map(|e| e.value.weight()).sum();
                shard.entries.clear();
                self.mapped_bytes.fetch_sub(bytes, Ordering::AcqRel);
                shard.order.clear();
                self.count.fetch_sub(n, Ordering::AcqRel);
            }
        }
    }
    pub fn mapped_bytes(&self) -> usize {
        self.mapped_bytes.load(Ordering::Acquire)
    }
    pub fn entries(&self) -> usize {
        self.count.load(Ordering::Acquire)
    }
    pub fn used_bytes(&self) -> usize {
        self.budget.used()
    }
}
