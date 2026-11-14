# Spec: server2 log pipeline LP-4 (#2981)

- **LP4-AC1 Notice.** With a metadata stand-in announcing an interruption, every line of the server unit's journal up to its stop reaches each selected remote destination, and the measured time from notice to collector stop is inside the documented budget (detection 5 s + server stop 45 s, its TimeoutStopSec + drain 10 s + collector flush 20 s = 80 s; margin 40 s to the 120 s notice).
- **LP4-AC2 Order.** The `collector.interruption_notice` record (announced action and time) is at each selected remote destination and precedes the server's shutdown records.
- **LP4-AC3 Shutdown.** A normal system shutdown without a notice stops the server unit before the collector and delivers the server's final records.
- **LP4-AC4 Without notice.** In normal operation the delay from journal to destination is at most 60 s for S3 (objects close every 50 s) and 10 s for CloudWatch; after an abrupt power-off, every record missing at a destination is younger than that bound.
- **LP4-AC5 Idle.** On On-Demand and without instance metadata the watcher runs without error and starts no stop.
- **LP4-AC6 Documentation.** Guide (interruption sequence, budget, loss without notice), infrastructure watcher statement, diagram; links and placement pass.
