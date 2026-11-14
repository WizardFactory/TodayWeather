# Spec: server2 log pipeline LP-3 (#2980)

- **LP3-AC1 Fresh host.** A new Linux host with nothing installed, given only the generated user data (and the metadata, S3 and CloudWatch stand-ins), installs the pinned collector after checking its hash, starts it, and ships the server's records from the first one, exactly once, with no manual step and no AWS key on the host (credentials from the instance role through IMDSv2).
- **LP3-AC2 Several instances.** Two instance IDs with the identical configuration writing in the same hour produce disjoint stream names and S3 keys; each destination holds both instances' records completely and nothing is overwritten.
- **LP3-AC3 Start record.** Each `collector.started` record holds instance ID, boot ID, life cycle, collector version and active destinations (and the earlier boots it still ships).
- **LP3-AC4 Spot warning.** With `SERVER2_LOG_SINKS=local` on a Spot instance a `collector.local_only_on_spot` warning is written at start; on On-Demand it is not.
- **LP3-AC5 Surviving disk.** After a reboot on the same disk, records of the previous boot not yet shipped arrive at the destinations under the previous boot's names, new records carry the new boot ID, both exactly once after a clean stop; the documented repeat bound covers abrupt stops. A later start has no backlog left.
- **LP3-AC6 Empty disk.** A start without earlier state works (covered by AC1 and every `linux_check` scenario, which starts from an emptied state directory).
- **LP3-AC7 Documentation.** The guide covers boot configuration, identity, several instances, surviving disk with its repeat bound and the rejected configuration on an unattended instance; diagram updated; links and placement pass.
