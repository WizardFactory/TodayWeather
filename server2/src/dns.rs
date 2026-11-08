//! Name resolution of every outbound HTTP client (KMA-RESTART-CPU DNS). reqwest's default
//! resolver runs getaddrinfo on the blocking pool, where after a restart a lookup for a new
//! connection queued behind restore decoding and disk-cache work. Every client starts from
//! [`client`], whose resolver is hickory's async one: lookups never leave the async workers.
use hickory_resolver::{TokioResolver, config::LookupIpStrategy};
use std::{
    net::SocketAddr,
    sync::{Arc, OnceLock},
};

/// The builder every outbound HTTP client starts from: reqwest's, resolving names with
/// [`AsyncDns`].
pub fn client() -> reqwest::ClientBuilder {
    reqwest::Client::builder().dns_resolver(Arc::new(AsyncDns::default()))
}

/// hickory's resolver with the system configuration (`/etc/resolv.conf` and the hosts file),
/// built on a client's first lookup inside its runtime. It asks for A first and for AAAA only
/// when the name has no A, as getaddrinfo (AI_ADDRCONFIG) does on the IPv4-only hosts the
/// service runs on: IPv4 comes first, and a name the hosts file maps to IPv4 answers from it
/// without waiting for DNS. Without a readable system configuration lookups fail: no public
/// resolver stands in.
#[derive(Default)]
struct AsyncDns {
    source: Source,
    resolver: OnceLock<Result<TokioResolver, String>>,
}
/// What a client's resolver is built from.
#[derive(Default)]
enum Source {
    /// The system configuration.
    #[default]
    System,
    /// A given configuration, options and hosts table (tests).
    #[cfg(test)]
    Fixed(Box<Fixed>),
}
#[cfg(test)]
struct Fixed {
    config: hickory_resolver::config::ResolverConfig,
    options: hickory_resolver::config::ResolverOpts,
    hosts: Arc<hickory_resolver::Hosts>,
}
impl AsyncDns {
    fn build(&self) -> Result<TokioResolver, String> {
        let mut builder = match &self.source {
            Source::System => TokioResolver::builder_tokio()
                .map_err(|e| format!("system DNS configuration: {e}"))?,
            #[cfg(test)]
            Source::Fixed(fixed) => {
                let mut builder = TokioResolver::builder_with_config(
                    fixed.config.clone(),
                    hickory_resolver::net::runtime::TokioRuntimeProvider::default(),
                );
                *builder.options_mut() = fixed.options.clone();
                builder
            }
        };
        builder.options_mut().ip_strategy = LookupIpStrategy::Ipv4thenIpv6;
        let resolver = builder.build().map_err(|e| format!("DNS resolver: {e}"))?;
        #[cfg(test)]
        let resolver = {
            let mut resolver = resolver;
            if let Source::Fixed(fixed) = &self.source {
                resolver.set_hosts(fixed.hosts.clone());
            }
            resolver
        };
        Ok(resolver)
    }
}
impl reqwest::dns::Resolve for AsyncDns {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let resolver = self.resolver.get_or_init(|| self.build()).clone();
        Box::pin(async move {
            let found = resolver?.lookup_ip(name.as_str()).await?;
            let addrs: Vec<SocketAddr> = found.iter().map(|ip| SocketAddr::new(ip, 0)).collect();
            let addrs: reqwest::dns::Addrs = Box::new(addrs.into_iter());
            Ok(addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use hickory_resolver::config::{
        ConnectionConfig, NameServerConfig, ResolverConfig, ResolverOpts,
    };
    use hickory_resolver::proto::{
        op::{Message, ResponseCode},
        rr::{
            Name, RData, Record, RecordType,
            rdata::{A, AAAA},
        },
    };
    use reqwest::dns::Resolve;
    use std::{
        net::{IpAddr, SocketAddr},
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst},
        },
        time::Duration,
    };

    /// A DNS server on loopback UDP answering A and AAAA from its records with their TTLs:
    /// NXDOMAIN for a name it does not know, an empty answer for a type a known name lacks. It
    /// records every query as (name, type).
    struct Answering {
        port: u16,
        queries: Queries,
        stop: Arc<AtomicBool>,
    }
    /// The queries a double received, as (name, type).
    type Queries = Arc<Mutex<Vec<(String, RecordType)>>>;
    impl Answering {
        fn start(records: &[(&str, &str, u32)]) -> Self {
            let records: Vec<(Name, IpAddr, u32)> = records
                .iter()
                .map(|(name, ip, ttl)| (Name::from_ascii(name).unwrap(), ip.parse().unwrap(), *ttl))
                .collect();
            let socket = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
            socket
                .set_read_timeout(Some(Duration::from_millis(50)))
                .unwrap();
            let port = socket.local_addr().unwrap().port();
            let (queries, stop) = (Arc::default(), Arc::new(AtomicBool::new(false)));
            let (seen, stopped): (Queries, _) = (Arc::clone(&queries), stop.clone());
            std::thread::spawn(move || {
                let mut buffer = [0u8; 512];
                while !stopped.load(SeqCst) {
                    let Ok((n, peer)) = socket.recv_from(&mut buffer) else {
                        continue;
                    };
                    let Ok(request) = Message::from_vec(&buffer[..n]) else {
                        continue;
                    };
                    let mut response =
                        Message::response(request.metadata.id, request.metadata.op_code);
                    response.metadata.recursion_desired = request.metadata.recursion_desired;
                    response.metadata.recursion_available = true;
                    for query in &request.queries {
                        seen.lock()
                            .unwrap()
                            .push((query.name().to_ascii(), query.query_type()));
                        response.add_query(query.clone());
                        let known: Vec<&(Name, IpAddr, u32)> = records
                            .iter()
                            .filter(|(n, _, _)| n == query.name())
                            .collect();
                        if known.is_empty() {
                            response.metadata.response_code = ResponseCode::NXDomain;
                        }
                        for (name, ip, ttl) in known {
                            let rdata = match (ip, query.query_type()) {
                                (IpAddr::V4(v4), RecordType::A) => RData::A(A(*v4)),
                                (IpAddr::V6(v6), RecordType::AAAA) => RData::AAAA(AAAA(*v6)),
                                _ => continue,
                            };
                            response.add_answer(Record::from_rdata(name.clone(), *ttl, rdata));
                        }
                    }
                    if let Ok(bytes) = response.to_vec() {
                        let _ = socket.send_to(&bytes, peer);
                    }
                }
            });
            Self {
                port,
                queries,
                stop,
            }
        }
        fn queries(&self) -> Vec<(String, RecordType)> {
            self.queries.lock().unwrap().clone()
        }
    }
    impl Drop for Answering {
        fn drop(&mut self) {
            self.stop.store(true, SeqCst);
        }
    }
    /// IPv4 addresses come before any IPv6 one: no IPv4 after the first IPv6.
    fn ipv4_first(found: &[SocketAddr]) -> bool {
        found
            .iter()
            .skip_while(|a| a.is_ipv4())
            .all(|a| a.is_ipv6())
    }
    async fn resolved(resolver: &super::AsyncDns, name: &str) -> Vec<SocketAddr> {
        tokio::time::timeout(
            Duration::from_secs(1),
            resolver.resolve(name.parse().unwrap()),
        )
        .await
        .expect("the lookup took over a second")
        .unwrap()
        .collect()
    }
    /// A loopback HTTP server answering 200 to every request; its port.
    async fn serve_ok() -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut request = [0u8; 1024];
                    let _ = stream.read(&mut request).await;
                    let response = [
                        "HTTP/1.1 200 OK",
                        "content-length: 2",
                        "connection: close",
                        "",
                        "ok",
                    ]
                    .join("\r\n");
                    let _ = stream.write_all(response.as_bytes()).await;
                });
            }
        });
        port
    }

    /// A DNS server on loopback UDP that never answers; it counts the queries it receives.
    struct Silent {
        port: u16,
        queries: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
    }
    impl Silent {
        fn start() -> Self {
            let socket = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
            socket
                .set_read_timeout(Some(Duration::from_millis(50)))
                .unwrap();
            let port = socket.local_addr().unwrap().port();
            let (queries, stop) = (
                Arc::new(AtomicUsize::new(0)),
                Arc::new(AtomicBool::new(false)),
            );
            let (seen, stopped) = (queries.clone(), stop.clone());
            std::thread::spawn(move || {
                let mut buffer = [0u8; 512];
                while !stopped.load(SeqCst) {
                    if socket.recv_from(&mut buffer).is_ok() {
                        seen.fetch_add(1, SeqCst);
                    }
                }
            });
            Self {
                port,
                queries,
                stop,
            }
        }
    }
    impl Drop for Silent {
        fn drop(&mut self) {
            self.stop.store(true, SeqCst);
        }
    }
    /// One UDP name server on loopback at `port`.
    fn servers(port: u16) -> ResolverConfig {
        let mut udp = ConnectionConfig::udp();
        udp.port = port;
        ResolverConfig::from_parts(
            None,
            vec![],
            vec![NameServerConfig::new(
                std::net::Ipv4Addr::LOCALHOST.into(),
                true,
                vec![udp],
            )],
        )
    }
    /// A client resolver built from `config`, `options` and a hosts file text.
    fn fixed(config: ResolverConfig, options: ResolverOpts, hosts: &str) -> super::AsyncDns {
        let mut table = hickory_resolver::Hosts::default();
        table.read_hosts_conf(hosts.as_bytes()).unwrap();
        super::AsyncDns {
            source: super::Source::Fixed(Box::new(super::Fixed {
                config,
                options,
                hosts: Arc::new(table),
            })),
            resolver: Default::default(),
        }
    }

    /// DNS (RC-hosts-aaaa-stall): a name the hosts file maps to IPv4 only answers from it while
    /// the DNS server does not answer: no query is sent and the address arrives within the S3
    /// connect limit (1 s), as getaddrinfo answers it on an IPv4-only host.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_ipv4_hosts_entry_answers_without_waiting_for_dns() {
        let dns = Silent::start();
        let resolver = fixed(
            servers(dns.port),
            ResolverOpts::default(),
            "192.0.2.10 s3.test\n",
        );
        let found: Vec<SocketAddr> = tokio::time::timeout(
            Duration::from_secs(1),
            resolver.resolve("s3.test".parse().unwrap()),
        )
        .await
        .expect("the lookup waited for the DNS server")
        .unwrap()
        .collect();
        assert_eq!(found, vec![SocketAddr::from(([192, 0, 2, 10], 0))]);
        assert_eq!(dns.queries.load(SeqCst), 0, "queries sent to DNS");
    }

    /// DNS: every outbound HTTP client of the service starts from [`super::client`] (no other
    /// reqwest client construction in `src/`).
    #[test]
    fn every_http_client_starts_from_the_async_resolver() {
        fn sources(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            for entry in std::fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    sources(&path, out);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    out.push(path);
                }
            }
        }
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        sources(&root, &mut files);
        let direct: Vec<String> = files
            .iter()
            .filter(|p| !p.ends_with("dns.rs"))
            .filter(|p| {
                let source = std::fs::read_to_string(p).unwrap();
                [
                    "Client::builder(",
                    "ClientBuilder::new(",
                    "reqwest::Client::new(",
                ]
                .iter()
                .any(|c| source.contains(c))
            })
            .map(|p| p.display().to_string())
            .collect();
        assert!(files.len() > 100, "{} sources", files.len());
        assert!(
            direct.is_empty(),
            "built without the async resolver: {direct:?}"
        );
    }

    /// DNS: A and AAAA answers keep getaddrinfo's order on an IPv4-only host, IPv4 first.
    #[tokio::test]
    async fn the_resolver_answers_ipv4_first() {
        let found: Vec<std::net::SocketAddr> = super::AsyncDns::default()
            .resolve("localhost".parse().unwrap())
            .await
            .unwrap()
            .collect();
        assert!(!found.is_empty());
        assert!(found[0].is_ipv4(), "{found:?}");
        assert!(ipv4_first(&found), "{found:?}");
    }

    /// DNS: with the only blocking thread held, a request to a name (`localhost`) still resolves
    /// and is answered: the lookup does not wait for the blocking pool.
    #[test]
    fn a_lookup_does_not_wait_for_the_blocking_pool() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            tokio::spawn(async move {
                while let Ok((mut stream, _)) = listener.accept().await {
                    tokio::spawn(async move {
                        use tokio::io::{AsyncReadExt, AsyncWriteExt};
                        let mut request = [0u8; 1024];
                        let _ = stream.read(&mut request).await;
                        let response = [
                            "HTTP/1.1 200 OK",
                            "content-length: 2",
                            "connection: close",
                            "",
                            "ok",
                        ]
                        .join("\r\n");
                        let _ = stream.write_all(response.as_bytes()).await;
                    });
                }
            });
            // Hold the only blocking thread until the request is answered.
            let (started, held) = tokio::sync::oneshot::channel::<()>();
            let (release, wait) = std::sync::mpsc::channel::<()>();
            let blocking = tokio::task::spawn_blocking(move || {
                let _ = started.send(());
                let _ = wait.recv();
            });
            held.await.unwrap();
            let client = super::client().no_proxy().build().unwrap();
            let answered = tokio::time::timeout(
                Duration::from_secs(5),
                client.get(format!("http://localhost:{port}/")).send(),
            )
            .await;
            release.send(()).unwrap();
            blocking.await.unwrap();
            let response = answered
                .expect("the lookup waited for the blocking pool")
                .unwrap();
            assert_eq!(response.status(), 200);
        });
    }

    /// DNS: a name with A and AAAA answers its IPv4 addresses without asking AAAA; a name with
    /// AAAA only answers IPv6 after an empty A answer. IPv4 always comes first.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_and_aaaa_answers_keep_ipv4_first() {
        let dns = Answering::start(&[
            ("both.test.", "192.0.2.1", 60),
            ("both.test.", "192.0.2.2", 60),
            ("both.test.", "2001:db8::1", 60),
            ("six.test.", "2001:db8::2", 60),
        ]);
        let resolver = fixed(servers(dns.port), ResolverOpts::default(), "");
        let both = resolved(&resolver, "both.test").await;
        assert_eq!(both.len(), 2, "{both:?}");
        assert!(both.iter().all(SocketAddr::is_ipv4), "{both:?}");
        let six = resolved(&resolver, "six.test").await;
        assert_eq!(
            six,
            vec![SocketAddr::from(([0x2001, 0xdb8, 0, 0, 0, 0, 0, 2], 0))]
        );
        assert!(ipv4_first(&both) && ipv4_first(&six));
        assert_eq!(
            dns.queries(),
            vec![
                ("both.test.".to_owned(), RecordType::A),
                ("six.test.".to_owned(), RecordType::A),
                ("six.test.".to_owned(), RecordType::AAAA),
            ]
        );
    }

    /// DNS: an answer is reused for its TTL and asked again once it expired.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_answer_is_reused_for_its_ttl() {
        let dns = Answering::start(&[("ttl.test.", "192.0.2.3", 1)]);
        let resolver = fixed(servers(dns.port), ResolverOpts::default(), "");
        resolved(&resolver, "ttl.test").await;
        resolved(&resolver, "ttl.test").await;
        assert_eq!(dns.queries().len(), 1, "{:?}", dns.queries());
        tokio::time::sleep(Duration::from_millis(1500)).await;
        assert_eq!(
            resolved(&resolver, "ttl.test").await,
            vec![SocketAddr::from(([192, 0, 2, 3], 0))]
        );
        assert_eq!(dns.queries().len(), 2, "{:?}", dns.queries());
    }

    /// DNS: a name with fewer dots than ndots is asked under the search domains first; one with
    /// enough dots is asked as given.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn search_domains_follow_ndots() {
        let dns = Answering::start(&[
            ("svc.corp.test.", "192.0.2.4", 60),
            ("api.example.test.", "192.0.2.5", 60),
        ]);
        let mut config = servers(dns.port);
        config = ResolverConfig::from_parts(
            None,
            vec![Name::from_ascii("corp.test.").unwrap()],
            config.name_servers().to_vec(),
        );
        let mut options = ResolverOpts::default();
        options.ndots = 1;
        let resolver = fixed(config, options, "");
        assert_eq!(
            resolved(&resolver, "svc").await,
            vec![SocketAddr::from(([192, 0, 2, 4], 0))]
        );
        assert_eq!(
            resolved(&resolver, "api.example.test").await,
            vec![SocketAddr::from(([192, 0, 2, 5], 0))]
        );
        let queries = dns.queries();
        assert_eq!(queries[0], ("svc.corp.test.".to_owned(), RecordType::A));
        assert!(
            queries.contains(&("api.example.test.".to_owned(), RecordType::A)),
            "{queries:?}"
        );
        assert!(
            !queries
                .iter()
                .any(|(n, _)| n == "api.example.test.corp.test."),
            "{queries:?}"
        );
    }

    /// DNS: an unknown name (NXDOMAIN) fails at once, and a server that never answers fails at
    /// the resolver timeout instead of hanging.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn lookups_fail_on_nxdomain_and_on_a_silent_server() {
        let dns = Answering::start(&[("known.test.", "192.0.2.6", 60)]);
        let resolver = fixed(servers(dns.port), ResolverOpts::default(), "");
        let missing = tokio::time::timeout(
            Duration::from_secs(1),
            resolver.resolve("missing.test".parse().unwrap()),
        )
        .await
        .expect("NXDOMAIN took over a second");
        assert!(missing.is_err());
        let silent = Silent::start();
        let mut options = ResolverOpts::default();
        options.timeout = Duration::from_millis(200);
        options.attempts = 1;
        let resolver = fixed(servers(silent.port), options, "");
        let failed = tokio::time::timeout(
            Duration::from_secs(3),
            resolver.resolve("known.test".parse().unwrap()),
        )
        .await
        .expect("the lookup hung on a silent server");
        assert!(failed.is_err());
        assert!(silent.queries.load(SeqCst) > 0);
    }

    /// DNS: clients on separate runtimes each build their own resolver; a runtime that ended
    /// does not take the next client's lookups with it.
    #[test]
    fn clients_on_separate_runtimes_resolve() {
        let dns = Answering::start(&[("svc.test.", "127.0.0.1", 60)]);
        for _ in 0..2 {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(1)
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async {
                let port = serve_ok().await;
                let client = reqwest::Client::builder()
                    .no_proxy()
                    .dns_resolver(Arc::new(fixed(
                        servers(dns.port),
                        ResolverOpts::default(),
                        "",
                    )))
                    .build()
                    .unwrap();
                let response = tokio::time::timeout(
                    Duration::from_secs(2),
                    client.get(format!("http://svc.test:{port}/")).send(),
                )
                .await
                .expect("the request took over two seconds")
                .unwrap();
                assert_eq!(response.status(), 200);
            });
            drop(runtime);
        }
        assert_eq!(
            dns.queries(),
            vec![
                ("svc.test.".to_owned(), RecordType::A),
                ("svc.test.".to_owned(), RecordType::A),
            ]
        );
    }

    /// DNS: with the only blocking thread held, a name a DNS server answers (not one hickory
    /// synthesizes, like `localhost`) still resolves and the request is answered.
    #[test]
    fn a_dns_query_does_not_wait_for_the_blocking_pool() {
        let dns = Answering::start(&[("svc.test.", "127.0.0.1", 60)]);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let port = serve_ok().await;
            let (started, held) = tokio::sync::oneshot::channel::<()>();
            let (release, wait) = std::sync::mpsc::channel::<()>();
            let blocking = tokio::task::spawn_blocking(move || {
                let _ = started.send(());
                let _ = wait.recv();
            });
            held.await.unwrap();
            let client = reqwest::Client::builder()
                .no_proxy()
                .dns_resolver(Arc::new(fixed(
                    servers(dns.port),
                    ResolverOpts::default(),
                    "",
                )))
                .build()
                .unwrap();
            let answered = tokio::time::timeout(
                Duration::from_secs(5),
                client.get(format!("http://svc.test:{port}/")).send(),
            )
            .await;
            release.send(()).unwrap();
            blocking.await.unwrap();
            let response = answered
                .expect("the lookup waited for the blocking pool")
                .unwrap();
            assert_eq!(response.status(), 200);
        });
        assert_eq!(dns.queries(), vec![("svc.test.".to_owned(), RecordType::A)]);
    }
}
