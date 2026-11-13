# Service EIP readiness

The checker is ported from the deployed `AttachEIPToSpot` Python 3.13 function, with its EIP safety logic preserved and bounded diagnostics added. The failure observer handles Lambda asynchronous OnFailure records and publishes only an allowlisted summary. It imports no EC2 client.

Run isolated checks from the repository root:

```sh
python3 -m unittest discover -s infra/aws/service-eip/tests -v
python3 infra/aws/service-eip/smoke.py
```

The smoke uses a real loopback HTTP server and fake AWS/SNS peers. It needs permission to bind a local socket. Neither command uses production credentials.

Package `lambda_function.py` at the root of the checker ZIP, and `failure_observer.py` at the root of a separate observer ZIP; Lambda supplies boto3. Keep ZIPs in ignored `reports/`, pin their hashes, and use a versioned artifact bucket for the observer. No package/deploy action runs automatically.

`notification-stack.json` prepares observer/IAM/alarms and the source OnFailure configuration. It does not deploy checker code or change its environment. See the [operations guide](../../../docs/operations/service-eip-readiness.md) for prerequisites, source provenance, verification and separately authorized rollout/rollback.
