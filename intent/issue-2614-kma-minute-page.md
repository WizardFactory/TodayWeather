# A held minute page answers without waiting

The EC2 verification of 2026-11-07 (01:29-03:12 KST, one request round every 5 minutes) showed one or two requests of most rounds taking 2.4-3.6 s. Each started the next KMA AWS minute page (`nph-aws_txt_min`, about 470 KB of EUC-KR HTML for every station), which took 2.1-2.6 s to arrive: at the observed 2.5 s bound. The request waited for it and usually still answered the previous page, five minutes older. Legacy collected the page every 2 minutes in the background and answered from the stored page. AK approved the fix on 2026-11-07 ("진행").

## Outcomes

- **HELD:** while a minute page of the last 20 minutes (the readers' reach) is held, a request answers with it and does not wait for the next page; the next page is acquired beside the request and serves later requests.
- **COLD:** without a held page (a cold process with no stored page) the request waits for the page as before.
- **UNCHANGED:** the acquisition cadence (at most one page per 2 minutes, whatever the outcome) and the other observation pages are unchanged.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Decision for AK

- A request that arrives when the next page is due answers the held page, up to about 4 minutes old (2-minute cadence plus the page's own lag), instead of waiting up to 2.5 s for a page it usually missed anyway.

## Exclusions

Not in this change: a scheduled background fetch without requests, the hourly and city pages, and fixes 1-3 of the EC2 report.
