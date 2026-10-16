use server2::storage::{
    CatalogTransport, ControlObject, Error, Object, ObjectTransport, PreparedRecord, WriteCondition,
};
use std::sync::{Arc, Mutex};
#[derive(Clone, Default)]
pub struct Memory(pub Arc<Mutex<Data>>);
#[derive(Default)]
pub struct Data {
    pub object: Option<ControlObject>,
    pub revision: u64,
    pub read_error: bool,
    pub corrupt: bool,
    pub refuse: bool,
    pub lost: bool,
    pub writes: usize,
    pub reads: usize,
    pub first_read_barrier: Option<Arc<tokio::sync::Barrier>>,
    pub unreadable_after_commit: bool,
    pub held_commit: Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>,
}
impl ObjectTransport for Memory {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        Err(Error::Invalid("unused raw"))
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
    async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
}
impl CatalogTransport for Memory {
    async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
        let (object, barrier) = {
            let mut d = self.0.lock().unwrap();
            d.reads += 1;
            if d.read_error {
                return Err(Error::Transport);
            }
            let object = if d.corrupt {
                Ok(ControlObject {
                    body: b"{".to_vec(),
                    etag: "\"bad\"".into(),
                    version: None,
                })
            } else {
                d.object.clone().ok_or(Error::NotFound)
            };
            (
                object,
                if d.reads <= 2 {
                    d.first_read_barrier.clone()
                } else {
                    None
                },
            )
        };
        if let Some(barrier) = barrier {
            barrier.wait().await;
        }
        object
    }
    async fn put_control(
        &self,
        _: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, Error> {
        let (answer, held) = {
            let mut d = self.0.lock().unwrap();
            d.writes += 1;
            if d.refuse {
                return Ok(403);
            }
            let agrees = match (condition, &d.object) {
                (WriteCondition::Absent, None) => true,
                (WriteCondition::Match(e), Some(o)) => *e == o.etag,
                _ => false,
            };
            if !agrees {
                return Ok(412);
            }
            d.revision += 1;
            d.object = Some(ControlObject {
                body: body.to_vec(),
                etag: format!("\"v{}\"", d.revision),
                version: Some(d.revision.to_string()),
            });
            if d.unreadable_after_commit {
                d.read_error = true;
            }
            let answer = if d.lost {
                d.lost = false;
                Err(Error::Transport)
            } else {
                Ok(200)
            };
            (answer, d.held_commit.take())
        };
        if let Some((entered, release)) = held {
            entered.notify_one();
            release.notified().await;
        }
        answer
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        Err(Error::Invalid("unused list"))
    }
}
